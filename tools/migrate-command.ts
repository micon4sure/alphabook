/** Explicit 0.1 -> 0.2 migration. Source files are kept under .git as a recovery copy. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { contained, git, gitOrNull, metadata, Registry } from '../packages/core/index';
import { importPlanning } from '../packages/core/write';

export function migrate(path: string, home?: string) {
  const root = realpathSync(path);
  if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root) throw new Error('Pass the exact repository root');
  const commonDir = realpathSync(resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim()));
  if (gitOrNull(commonDir, ['show-ref', '--verify', 'refs/heads/command'])) throw new Error('command already exists; refusing to migrate');
  if (git(root, ['diff', '--cached', '--name-only', '--', '.command']).trim()) throw new Error('Planning changes are staged; commit or unstage them before explicit migration');
  const files = new Map<string, string>();
  function walk(folder: string) {
    for (const entry of readdirSync(contained(root, folder), { withFileTypes: true })) {
      const rel = `${folder}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Migration refuses symlinks; handle them explicitly first');
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) {
        const bytes = readFileSync(contained(root, rel));
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (text.includes('\0')) throw new Error('This migration helper supports UTF-8 planning files only; migrate binary artifacts explicitly');
        files.set(rel, text);
      } else throw new Error('Migration only supports ordinary planning files');
    }
  }
  walk('.command');
  const old = metadata(files.get('.command/project.yaml') || '') as Record<string, unknown>;
  if (old.format !== 'repo-project' || old.format_version !== '0.1' || typeof old.integration_branch !== 'string') throw new Error('Explicit migration supports RPF 0.1 only');
  const { integration_branch, ...rest } = old;
  files.set('.command/project.yaml', stringify({ ...rest, format_version: '0.2', planning_branch: 'command', code_branch: integration_branch }));
  const result = importPlanning(root, files, 'Move the shared plan into its own orphan command branch', ['CMD-006'].filter(id => files.has(`.command/tasks/${id}.md`)));
  const backup = mkdtempSync(join(commonDir, 'command-migration-backup-'));
  // Move, don't delete: original working records (including untracked files) remain recoverable.
  renameSync(join(root, '.command'), join(backup, '.command'));
  if (git(root, ['ls-files', '--', '.command']).trim()) git(root, ['add', '-u', '--', '.command']);
  const project = new Registry(home).register(root);
  return { ...result, project, backup, note: 'Original planning files retained in backup; code-branch deletions are staged for review. Code HEAD and unrelated staged changes were not changed.' };
}
if (import.meta.main) {
  if (!process.argv[2]) throw new Error('Usage: bun tools/migrate-command.ts /absolute/repository');
  console.log(JSON.stringify(migrate(process.argv[2]), null, 2));
}
