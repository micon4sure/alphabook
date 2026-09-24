import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { contained, git, metadata, parseRecord, snapshot, taskCommits, worktrees } from '../packages/core/index';
import { fixture, task } from './fixture';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() { const f = fixture(); cleanups.push(f.cleanup); return f; }

describe('strict draft format', () => {
  test('YAML 1.2 core, CRLF and exact body preservation', () => {
    expect(metadata('name: yes\nvalue: 2026-09-24\nflag: true')).toEqual({ name: 'yes', value: '2026-09-24', flag: true });
    const row = parseRecord(task('T-1', 'planned', '', '\n# Body\n').replaceAll('\n', '\r\n'), '.command/tasks/T-1.md', 'task');
    expect(row.body).toBe('\r\n# Body\r\n');
  });
  test.each(['a: 1\na: 2', 'a: &x 1', 'a: *x', 'a: !!str x', '1: value', 'a: .inf', '\uFEFFa: 1'])('rejects invalid metadata: %s', text => expect(() => metadata(text)).toThrow());
  test('rejects unknown fields, filename mismatch and missing frontmatter', () => {
    expect(() => parseRecord(task('T-1', 'planned', 'surprise: true\n'), 'T-1.md', 'task')).toThrow();
    expect(() => parseRecord(task('T-1', 'planned'), 'T-2.md', 'task')).toThrow();
    expect(() => parseRecord('body\n' + task('T-1', 'planned'), 'T-1.md', 'task')).toThrow();
  });
});
test('registration accepts .command, deduplicates worktrees and differentiates clones', () => {
  const f = setup();
  expect(f.registry.register(join(f.root, '.command')).id).toBe(f.project.id);
  const linked = join(f.dir, 'linked'); git(f.root, ['worktree', 'add', '-b', 'feature', linked]);
  expect(f.registry.register(linked).id).toBe(f.project.id);
  const clone = join(f.dir, 'clone'); git(f.root, ['clone', f.root, clone]);
  expect(f.registry.register(clone).id).not.toBe(f.project.id);
  expect(f.registry.list()).toHaveLength(2);
  f.registry.unregister(f.project.id);
  expect(worktrees(f.project)).toHaveLength(2);
});
test('external edits are immediately visible; dependencies govern ready tasks', () => {
  const f = setup(), id = worktrees(f.project)[0].id;
  const first = snapshot(f.project, id);
  expect(first.errors).toEqual([]);
  expect(first.tasks.map(t => t.ready)).toEqual([true, false]);
  f.put('.command/tasks/T-001.md', task('T-001', 'done'));
  const next = snapshot(f.project, id);
  expect(next.revision).not.toBe(first.revision);
  expect(next.context.dirty).toBe(true);
  expect(next.tasks[1].ready).toBe(true);
  expect(next.documents[0].text).toContain('Ordinary files');
});
test('checkout progress stays separate until code and planning integrate', () => {
  const f = setup(), linked = join(f.dir, 'linked');
  git(f.root, ['worktree', 'add', '-b', 'feature', linked]);
  const id = worktrees(f.project).find(w => w.branch === 'feature')!.id;
  f.put('src/result.txt', 'implementation', linked);
  f.put('.command/tasks/T-001.md', task('T-001', 'done'), linked);
  git(linked, ['add', '.']); git(linked, ['commit', '-m', 'Implement\n\nTask: T-001']);
  expect(snapshot(f.project, id).tasks[0].meta.status).toBe('done');
  expect(snapshot(f.project, id, 'accepted').tasks[0].meta.status).toBe('planned');
  // Accepted state is not assembled from dirty worktree files, even its manifest.
  f.put('.command/project.yaml', 'broken: [', linked);
  expect(snapshot(f.project, id, 'accepted').project.name).toBe('Test project');
  git(f.root, ['merge', '--ff-only', 'feature']);
  expect(snapshot(f.project, id, 'accepted').tasks[0].meta.status).toBe('done');
  expect(taskCommits(f.project, id, 'T-001', 'accepted').commits).toHaveLength(2);
});
test('detects invalid references, cycles, missing artifacts and duplicate IDs', () => {
  const f = setup(), id = worktrees(f.project)[0].id;
  f.put('.command/tasks/T-001.md', task('T-001', 'planned', 'depends_on: [T-002]\ndecisions: [D-missing]\nartifacts: [missing.txt]\n'));
  f.put('.command/decisions/T-001.md', '---\nkind: decision\nid: T-001\ntitle: Duplicate\nstatus: accepted\n---\n');
  const result = snapshot(f.project, id);
  expect(result.errors.join('\n')).toContain('cycle');
  expect(result.errors.join('\n')).toContain('D-missing');
  expect(result.errors.join('\n')).toContain('Duplicate');
  expect(result.errors.join('\n')).toContain('missing.txt');
  expect(result.tasks.some(t => t.ready)).toBe(false);
});
test('rejects traversal, symlink escapes, dangling links and BOM in files', () => {
  const f = setup(), id = worktrees(f.project)[0].id;
  for (const p of ['../outside', '/etc/passwd', '.git/config', 'a//b', 'a\\b']) expect(() => contained(f.root, p)).toThrow();
  writeFileSync(join(f.dir, 'outside'), 'not project data');
  symlinkSync(join(f.dir, 'outside'), join(f.root, '.command/docs/escape.md'));
  expect(snapshot(f.project, id).errors.join('\n')).toContain('escapes');
  symlinkSync(join(f.dir, 'missing'), join(f.root, 'dangling'));
  expect(() => contained(f.root, 'dangling')).toThrow('dangling');
  f.put('.command/tasks/T-001.md', '\uFEFF' + task('T-001', 'planned'));
  expect(snapshot(f.project, id).errors.join('\n')).toContain('frontmatter');
});
test('commit links use real trailers, preserve task ID case, and disclose limits', () => {
  const f = setup(), id = worktrees(f.project)[0].id;
  git(f.root, ['commit', '--allow-empty', '-m', 'Mention\n\nTask: T-001\n\nThis is only body text.']);
  git(f.root, ['commit', '--allow-empty', '-m', 'Multi\n\ntAsK: T-001\nTask: T-002']);
  git(f.root, ['commit', '--allow-empty', '-m', 'Wrong case\n\nTask: t-001']);
  const result = taskCommits(f.project, id, 'T-001');
  expect(result.commits.map(c => c.subject)).toEqual(['Multi', 'Initial plan']);
  expect(taskCommits(f.project, id, 'T-001', 'checkout', 1).truncated).toBe(true);
});
test('detached and removed registration checkout do not break worktree discovery', () => {
  const f = setup(), linked = join(f.dir, 'linked');
  git(f.root, ['worktree', 'add', '--detach', linked]);
  const registered = f.registry.register(linked);
  expect(worktrees(registered).find(w => w.root === linked)?.branch).toBeNull();
  git(f.root, ['worktree', 'remove', linked]);
  expect(worktrees(registered)).toHaveLength(1);
});
test('unborn repositories work without pretending accepted history exists', () => {
  const f = setup();
  git(f.root, ['checkout', '--orphan', 'unborn']);
  git(f.root, ['rm', '--cached', '-r', '.']);
  const id = worktrees(f.project)[0].id;
  expect(snapshot(f.project, id).context.head).toBeNull();
  expect(taskCommits(f.project, id, 'T-001').commits).toEqual([]);
});
