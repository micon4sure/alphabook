import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { planningHead, git, snapshot, worktrees } from '../packages/core/index';
import { fixture, task } from './fixture';

// Execute the published instructions, not a separately maintained implementation.
const primer = readFileSync(resolve('AGENT_PRIMER.md'), 'utf8');
const script = /<!-- git-crud:start -->\s*```bash\n([\s\S]*?)\n```\s*<!-- git-crud:end -->/.exec(primer)?.[1];
if (!script) throw new Error('Missing executable Git CRUD block in the agent primer');
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() { const f = fixture(); cleanups.push(f.cleanup); return f; }
function run(root: string, action: string, path: string, head: string, input?: string) {
  return spawnSync('bash', ['-c', script!], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: {
      ...process.env, ALPHABOOK_ACTION: action, ALPHABOOK_RECORD: path,
      ALPHABOOK_EXPECTED_HEAD: head, ALPHABOOK_INPUT: input || '',
      ALPHABOOK_TOOL_ROOT: resolve('.'), ALPHABOOK_MESSAGE: 'Test the published primer\n\nTask: T-001',
    },
  });
}
function succeeded(result: ReturnType<typeof run>) {
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  expect(result.stdout).toContain('Published alphabook commit:');
}

test('primer Git CRUD creates, reads, updates and deletes without touching code', () => {
  const f = setup(), input = join(f.project.commonDir, 'prepared.md');
  f.put('staged.txt', 'staged'); git(f.root, ['add', 'staged.txt']);
  f.put('README.md', 'dirty source'); f.put('untracked.txt', 'untracked');
  const head = git(f.root, ['rev-parse', 'HEAD']), status = git(f.root, ['status', '--porcelain=v1']);
  const index = readFileSync(join(f.project.commonDir, 'index'));
  const path = 'docs/from-primer.md';
  writeFileSync(input, '# Created by the primer\n');
  succeeded(run(f.root, 'upsert', path, planningHead(f.project.commonDir), input));
  expect(git(f.root, ['show', `alphabook:${path}`])).toBe('# Created by the primer\n');
  writeFileSync(input, '# Updated\n');
  succeeded(run(f.root, 'upsert', path, planningHead(f.project.commonDir), input));
  const previous = planningHead(f.project.commonDir);
  expect(git(f.root, ['show', `alphabook:${path}`])).toBe('# Updated\n');
  succeeded(run(f.root, 'delete', path, previous));
  expect(() => git(f.root, ['show', `alphabook:${path}`])).toThrow();
  expect(git(f.root, ['show', `${previous}:${path}`])).toBe('# Updated\n');
  expect(snapshot(f.project).errors).toEqual([]);
  expect(git(f.root, ['rev-parse', 'HEAD'])).toBe(head);
  expect(git(f.root, ['status', '--porcelain=v1'])).toBe(status);
  expect(readFileSync(join(f.project.commonDir, 'index'))).toEqual(index);
  expect(readdirSync(f.project.commonDir).filter(p => p.startsWith('alphabook-crud.'))).toEqual([]);
  expect(existsSync(join(f.root, '.alphabook'))).toBe(false);
  expect(worktrees(f.project)).toHaveLength(1);
}, 15_000);

test('primer validates edits and broken deletions and refuses stale revisions', () => {
  const f = setup(), input = join(f.project.commonDir, 'prepared.md');
  const path = 'tasks/T-001.md', original = planningHead(f.project.commonDir);
  writeFileSync(input, task('T-001', 'planned', 'depends_on: [MISSING]\n'));
  expect(run(f.root, 'upsert', path, original, input).status).not.toBe(0);
  expect(planningHead(f.project.commonDir)).toBe(original);
  expect(run(f.root, 'delete', path, original).status).not.toBe(0); // T-002 depends on it.
  expect(planningHead(f.project.commonDir)).toBe(original);
  writeFileSync(input, task('T-001', 'done'));
  succeeded(run(f.root, 'upsert', path, original, input));
  const changed = planningHead(f.project.commonDir);
  expect(snapshot(f.project).tasks[1].ready).toBe(true);
  writeFileSync(input, task('T-001', 'cancelled'));
  expect(run(f.root, 'upsert', path, original, input).status).not.toBe(0);
  expect(planningHead(f.project.commonDir)).toBe(changed);
}, 15_000);

test('primer initializes an independent orphan history and refuses reinitialization', () => {
  const f = setup(), root = join(f.dir, 'fresh'); mkdirSync(root);
  git(root, ['init', '-b', 'master']);
  git(root, ['config', 'user.name', 'Primer Test']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '--allow-empty', '-m', 'Initial code']);
  const source = git(root, ['rev-parse', 'HEAD']), input = join(root, '.git', 'manifest.yaml');
  writeFileSync(input, `format: alphabook\nformat_version: "1.0"\nid: ${randomUUID()}\nname: Primer project\nplanning_branch: alphabook\ncode_branch: master\n`);
  succeeded(run(root, 'init', 'project.yaml', '', input));
  expect(git(root, ['rev-list', '--parents', '--max-count=1', 'alphabook']).trim().split(' ')).toHaveLength(1);
  expect(() => git(root, ['merge-base', 'master', 'alphabook'])).toThrow();
  expect(git(root, ['ls-tree', '--name-only', 'alphabook']).trim()).toBe('project.yaml');
  expect(git(root, ['rev-parse', 'HEAD'])).toBe(source);
  expect(git(root, ['branch', '--show-current']).trim()).toBe('master');
  expect(existsSync(join(root, '.alphabook'))).toBe(false);
  const project = f.registry.register(root), head = planningHead(project.commonDir);
  expect(snapshot(project).errors).toEqual([]);
  expect(run(root, 'init', 'project.yaml', '', input).status).not.toBe(0);
  expect(planningHead(project.commonDir)).toBe(head);
}, 15_000);

test('primer refuses unsafe paths and a checked-out planning branch', () => {
  const f = setup(), input = join(f.project.commonDir, 'prepared.md'), head = planningHead(f.project.commonDir);
  writeFileSync(input, '# Document\n');
  for (const path of ['source.md', '../source.md', 'docs\\bad.md', 'docs//bad.md', '.git/config']) {
    expect(run(f.root, 'upsert', path, head, input).status).not.toBe(0);
  }
  git(f.root, ['worktree', 'add', join(f.dir, 'planning'), 'alphabook']);
  expect(run(f.root, 'upsert', 'docs/new.md', head, input).status).not.toBe(0);
  expect(planningHead(f.project.commonDir)).toBe(head);
});
