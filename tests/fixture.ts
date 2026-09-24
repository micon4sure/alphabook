import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { git, Registry } from '../packages/core/index';

export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'command-test-'));
  const root = join(dir, 'project');
  mkdirSync(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Command Test']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  const put = (path: string, text: string, target = root) => {
    const full = join(target, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text);
  };
  put('.command/project.yaml', 'format: repo-project\nformat_version: "0.1"\nid: b556899e-eb59-4e98-89c4-157e62fddf1e\nname: Test project\nintegration_branch: main\n');
  put('.command/tasks/T-001.md', task('T-001', 'planned'));
  put('.command/tasks/T-002.md', task('T-002', 'planned', 'depends_on: [T-001]\n'));
  put('.command/decisions/D-001.md', '---\nkind: decision\nid: D-001\ntitle: Keep files portable\nstatus: accepted\n---\nDecision body.\n');
  put('.command/docs/guide.md', '# Guide\n\nOrdinary files work.\n');
  put('.command/artifacts/result.txt', 'Passed.');
  git(root, ['add', '.']); git(root, ['commit', '-m', 'Initial plan\n\nTask: T-001']);
  const registry = new Registry(join(dir, 'registry'));
  const project = registry.register(root);
  return { dir, root, put, registry, project, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
export function task(id: string, status: string, fields = '', body = 'Task description.\n') {
  return `---\nkind: task\nid: ${id}\ntitle: Task ${id}\nstatus: ${status}\n${fields}---\n${body}`;
}
