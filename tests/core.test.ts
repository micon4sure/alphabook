import { afterEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { commandHead, contained, digest, git, metadata, parseRecord, snapshot, taskCommits, worktrees } from '../packages/core/index';
import { overview } from '../packages/core/overview';
import { initializeProject, writePlanning } from '../packages/core/write';
import { fixture, task } from './fixture';
import { migrate } from '../tools/migrate-command';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() { const f = fixture(); cleanups.push(f.cleanup); return f; }

describe('strict format', () => {
  test('YAML 1.2 and exact CRLF body/content preservation', () => {
    expect(metadata('name: yes\nvalue: 2026-09-24\nflag: true')).toEqual({ name: 'yes', value: '2026-09-24', flag: true });
    const text = task('T-1', 'planned', '', '\n# Body\n').replaceAll('\n', '\r\n');
    const row = parseRecord(text, 'T-1.md', 'task');
    expect(row.body).toBe('\r\n# Body\r\n'); expect(row.content).toBe(text);
  });
  test.each(['a: 1\na: 2', 'a: &x 1', 'a: *x', 'a: !!str x', '1: value', 'a: .inf', '\uFEFFa: 1'])('rejects %s', text => expect(() => metadata(text)).toThrow());
  test('unknown fields and filename mismatch are rejected', () => {
    expect(() => parseRecord(task('T-1', 'planned', 'unknown: true\n'), 'T-1.md', 'task')).toThrow();
    expect(() => parseRecord(task('T-1', 'planned'), 'T-2.md', 'task')).toThrow();
  });
});
test('one orphan plan can be read without a planning checkout', () => {
  const f = setup(), state = snapshot(f.project);
  expect(state.errors).toEqual([]);
  expect(state.context.branch).toBe('command');
  expect(worktrees(f.project)).toHaveLength(1);
  expect(existsSync(join(f.root, '.command'))).toBe(false);
  expect(git(f.root, ['branch', '--show-current']).trim()).toBe('main');
  expect(git(f.root, ['ls-tree', '--name-only', 'command']).trim()).toBe('.command');
  expect(git(f.root, ['rev-list', '--parents', '--max-count=1', 'command']).trim().split(' ')).toHaveLength(1);
  expect(() => git(f.root, ['merge-base', 'main', 'command'])).toThrow();
  expect(state.tasks.map(t => t.ready)).toEqual([true, false]);
  f.put('.command/tasks/T-001.md', task('T-001', 'done'));
  expect(snapshot(f.project).tasks[0].meta.status).toBe('planned'); // Stray code-branch copies are never authoritative.
});
test('registration deduplicates code worktrees, distinguishes clones and supports a bare repo', () => {
  const f = setup(), linked = join(f.dir, 'linked');
  git(f.root, ['worktree', 'add', '-b', 'feature', linked]);
  expect(f.registry.register(linked).id).toBe(f.project.id);
  const clone = join(f.dir, 'clone'); git(f.root, ['clone', f.root, clone]);
  expect(() => f.registry.register(clone)).toThrow('No local command branch');
  git(clone, ['branch', 'command', 'origin/command']);
  expect(f.registry.register(clone).id).not.toBe(f.project.id);
  const bare = join(f.dir, 'bare.git'); git(f.root, ['clone', '--bare', f.root, bare]);
  const entry = f.registry.register(bare);
  expect(snapshot(entry).tasks).toHaveLength(2);
  expect(overview(entry).worktrees).toHaveLength(0);
});
test('four code worktrees share the same plan and are shown concurrently', () => {
  const f = setup();
  const changes = new Map<string, string>();
  for (let i = 1; i <= 4; i++) {
    const branch = `task/T-00${i}`;
    git(f.root, ['worktree', 'add', '-b', branch, join(f.dir, `worker-${i}`)]);
    changes.set(`.command/tasks/T-00${i}.md`, task(`T-00${i}`, 'in_progress', `branches: [${branch}]\nassignee: agent-${i}\n`));
  }
  f.rawPlan(changes);
  const state = overview(f.project);
  expect(state.worktrees).toHaveLength(5);
  expect(state.worktrees.filter(w => w.tasks.some(t => t.meta.status === 'in_progress'))).toHaveLength(4);
  expect(state.tasks).toHaveLength(4);
  expect(state.branches.filter(b => b.tasks.length)).toHaveLength(4);
  expect(state.warnings).toEqual([]);
  git(f.root, ['branch', '-m', 'master']);
  expect(snapshot(f.project).tasks).toHaveLength(4);
});
test('CRUD commits only planning and preserves staged and dirty code byte-for-byte', () => {
  const f = setup();
  f.put('staged.txt', 'staged code'); git(f.root, ['add', 'staged.txt']);
  f.put('README.md', 'dirty code'); f.put('untracked.txt', 'untracked code');
  const codeHead = git(f.root, ['rev-parse', 'HEAD']), index = readFileSync(join(f.project.commonDir, 'index')), before = git(f.root, ['status', '--porcelain=v1']);
  f.write('.command/tasks/T-001.md', task('T-001', 'done'));
  expect(snapshot(f.project).tasks[1].ready).toBe(true);
  f.write('.command/docs/new.md', '# New document');
  f.write('.command/docs/new.md', '# Edited document');
  const old = commandHead(f.project.commonDir);
  f.write('.command/docs/new.md', null);
  expect(snapshot(f.project).documents.some(d => d.path.endsWith('new.md'))).toBe(false);
  expect(git(f.root, ['show', `${old}:.command/docs/new.md`])).toBe('# Edited document');
  expect(git(f.root, ['rev-parse', 'HEAD'])).toBe(codeHead);
  expect(readFileSync(join(f.project.commonDir, 'index'))).toEqual(index);
  expect(git(f.root, ['status', '--porcelain=v1'])).toBe(before);
});
test('validation failure, stale head/revision and broken deletions never advance command', () => {
  const f = setup(), state = snapshot(f.project), row = state.tasks[0];
  const input = { project: f.project, path: row.path, content: task('T-001', 'done'), expectedHead: state.context.head, expectedRevision: row.revision, message: 'Complete task' };
  expect(() => writePlanning({ ...input, expectedRevision: '0'.repeat(64) })).toThrow('revision');
  expect(() => writePlanning({ ...input, content: task('T-001', 'done', 'depends_on: [T-002]\n') })).toThrow('cycle');
  expect(() => writePlanning({ ...input, content: null })).toThrow('missing depends_on');
  expect(commandHead(f.project.commonDir)).toBe(state.context.head);
  writePlanning(input);
  expect(() => writePlanning(input)).toThrow('advanced');
});
test('two independent writers cannot silently overwrite each other', async () => {
  const f = setup(), state = snapshot(f.project);
  const inputs = state.tasks.map(row => ({ projectId: f.project.id, path: row.path, content: row.content.replace('status: planned', 'status: in_progress'), expectedHead: state.context.head, expectedRevision: row.revision, message: 'Start work' }));
  const children = inputs.map(input => Bun.spawn([process.execPath, resolve('apps/cli.ts'), 'write', '-'], { env: { ...process.env, COMMAND_HOME: f.registry.home }, stdin: new Blob([JSON.stringify(input)]), stdout: 'pipe', stderr: 'pipe' }));
  const statuses = await Promise.all(children.map(child => child.exited));
  expect(statuses.sort()).toEqual([0, 1]);
  expect(snapshot(f.project).tasks.filter(t => t.meta.status === 'in_progress')).toHaveLength(1);
});
test('direct writes reject a checked-out planning branch instead of desynchronizing its files', () => {
  const f = setup(), planning = join(f.dir, 'planning');
  git(f.root, ['worktree', 'add', planning, 'command']);
  expect(() => f.write('.command/docs/new.md', 'text')).toThrow('checked out');
  f.put('.command/docs/guide.md', 'Uncommitted plan edits', planning);
  expect(snapshot(f.project).documents[0].text).toContain('Ordinary Git');
  expect(overview(f.project).planningWorktrees[0].dirty).toBe(true);
});
test('malformed external Git edits, non-planning files and reference errors are visible', () => {
  const f = setup();
  f.rawPlan(new Map([
    ['.command/tasks/T-001.md', task('T-001', 'planned', 'depends_on: [T-002]\ndecisions: [D-missing]\nartifacts: [.command/artifacts/missing.txt]\n')],
    ['source.txt', 'Not allowed on command'],
  ]));
  const state = snapshot(f.project);
  expect(state.errors.join('\n')).toContain('cycle');
  expect(state.errors.join('\n')).toContain('D-missing');
  expect(state.errors.join('\n')).toContain('missing.txt');
  expect(state.errors.join('\n')).toContain('non-planning');
  expect(state.tasks.some(t => t.ready)).toBe(false);
});
test('commit associations span code and planning history, parse real trailers, and disclose bounds', () => {
  const f = setup();
  git(f.root, ['commit', '--allow-empty', '-m', 'Implementation\n\nTask: T-001']);
  git(f.root, ['commit', '--allow-empty', '-m', 'Not a trailer\n\nTask: T-001\n\nOrdinary body.']);
  git(f.root, ['commit', '--allow-empty', '-m', 'Wrong case\n\nTask: t-001']);
  const result = taskCommits(f.project, 'T-001');
  expect(result.commits.map(c => c.subject).sort()).toEqual(['Implementation', 'Initial plan']);
  expect(result.commits.map(c => c.kind).sort()).toEqual(['code', 'planning']);
  expect(taskCommits(f.project, 'T-001', 1).truncated).toBe(true);
});
test('path traversal, symlink escapes and missing file deletion are refused', () => {
  const f = setup();
  for (const path of ['../outside', '/etc/passwd', '.git/config', 'a//b', 'a\\b']) expect(() => contained(f.root, path)).toThrow();
  symlinkSync(f.dir, join(f.root, 'outside'));
  expect(() => contained(f.root, 'outside/file')).toThrow('escapes');
  expect(() => f.write('.command/docs/../../source.txt', 'bad')).toThrow();
  expect(() => f.write('.command/project.yaml', 'bad')).toThrow('limited');
  expect(() => f.write('.command/docs/missing.md', null)).toThrow('missing');
});
test('initialization refuses to replace an existing command branch', () => {
  const f = setup(), before = commandHead(f.project.commonDir);
  expect(() => initializeProject(f.root, 'Duplicate', { home: f.registry.home })).toThrow('already exists');
  expect(commandHead(f.project.commonDir)).toBe(before);
});
test('initialize adds only planning history without checking out a directory', () => {
  const f = setup(), root = join(f.dir, 'fresh'); mkdirSync(root);
  git(root, ['init', '-b', 'master']);
  git(root, ['config', 'user.name', 'Command Test']); git(root, ['config', 'user.email', 'test@example.invalid']);
  const result = initializeProject(root, 'Fresh', { home: f.registry.home });
  expect(snapshot(result.project).project.code_branch).toBe('master');
  expect(git(root, ['branch', '--show-current']).trim()).toBe('master');
  expect(existsSync(join(root, '.command'))).toBe(false);
  expect(worktrees(result.project)).toHaveLength(1);
});
test('explicit migration preserves source history, a recovery copy, and unrelated staged code', () => {
  const f = setup(), legacy = join(f.dir, 'legacy'); mkdirSync(legacy);
  git(legacy, ['init', '-b', 'master']);
  git(legacy, ['config', 'user.name', 'Command Test']); git(legacy, ['config', 'user.email', 'test@example.invalid']);
  f.put('.command/project.yaml', 'format: repo-project\nformat_version: "0.1"\nid: b556899e-eb59-4e98-89c4-157e62fddf1e\nname: Legacy test\nintegration_branch: master\n', legacy);
  f.put('.command/tasks/T-001.md', task('T-001', 'planned'), legacy);
  f.put('README.md', 'code', legacy);
  git(legacy, ['add', '.']); git(legacy, ['commit', '-m', 'Existing history']);
  f.put('README.md', 'staged user code', legacy); git(legacy, ['add', 'README.md']);
  const before = git(legacy, ['rev-parse', 'HEAD']);
  const result = migrate(legacy, f.registry.home);
  expect(snapshot(result.project).errors).toEqual([]);
  expect(snapshot(result.project).project.code_branch).toBe('master');
  expect(existsSync(join(legacy, '.command'))).toBe(false);
  expect(readFileSync(join(result.backup, '.command/project.yaml'), 'utf8')).toContain('"0.1"');
  expect(git(legacy, ['show', ':README.md'])).toBe('staged user code');
  expect(git(legacy, ['rev-parse', 'HEAD'])).toBe(before);
  expect(() => git(legacy, ['merge-base', 'master', 'command'])).toThrow();
  expect(git(legacy, ['diff', '--cached', '--name-status'])).toContain('D\t.command/project.yaml');
});
