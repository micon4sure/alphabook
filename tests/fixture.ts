import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planningHead, digest, git, Registry } from '../packages/core/index';
import { importPlanning, writePlanning } from '../packages/core/write';

export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'alphabook-test-')), root = join(dir, 'project');
  mkdirSync(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Alphabook Test']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const put = (path: string, text: string, target = root) => {
    const full = join(target, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text);
  };
  put('README.md', '# Source code\n');
  git(root, ['add', 'README.md']); git(root, ['commit', '-m', 'Initial code']);
  const files = new Map([
    ['project.yaml', 'format: alphabook\nformat_version: "1.0"\nid: b556899e-eb59-4e98-89c4-157e62fddf1e\nname: Test project\nplanning_branch: alphabook\ncode_branch: main\n'],
    ['tasks/T-001.md', task('T-001', 'planned')],
    ['tasks/T-002.md', task('T-002', 'planned', 'depends_on: [T-001]\n')],
    ['decisions/D-001.md', '---\nkind: decision\nid: D-001\ntitle: Keep files portable\nstatus: accepted\n---\nDecision body.\n'],
    ['docs/guide.md', '# Guide\n\nOrdinary Git files work.\n'],
    ['artifacts/result.txt', 'Passed.'],
  ]);
  importPlanning(root, files, 'Initial plan', ['T-001']);
  const registry = new Registry(join(dir, 'registry')), project = registry.register(root);
  const write = (path: string, content: string | null, subject = 'Update planning') => {
    const head = planningHead(project.commonDir);
    let previous: string | null = null;
    try { previous = git(root, ['show', `${head}:${path}`]); } catch {}
    return writePlanning({ project, path, content, expectedHead: head, expectedRevision: previous === null ? null : digest(previous), message: subject });
  };
  // Deliberately bypass application validation to test malformed external Git edits.
  const rawPlan = (changes: Map<string, string>, subject = 'External Git planning edit') => {
    const temp = mkdtempSync(join(dir, 'index-')), before = planningHead(project.commonDir);
    const run = (args: string[], input?: string) => {
      const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', input, env: { ...process.env, GIT_INDEX_FILE: join(temp, 'index') } });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    try {
      run(['read-tree', before]);
      for (const [path, content] of changes) { const blob = run(['hash-object', '-w', '--stdin'], content); run(['update-index', '--add', '--cacheinfo', '100644', blob, path]); }
      const next = run(['commit-tree', run(['write-tree']), '-p', before], subject + '\n');
      run(['update-ref', 'refs/heads/alphabook', next, before]); return next;
    } finally { rmSync(temp, { recursive: true, force: true }); }
  };
  return { dir, root, put, registry, project, write, rawPlan, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
export function task(id: string, status: string, fields = '', body = 'Task description.\n') {
  return `---\nkind: task\nid: ${id}\ntitle: Task ${id}\nstatus: ${status}\n${fields}---\n${body}`;
}
