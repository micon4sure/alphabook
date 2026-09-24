import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stringify } from 'yaml';
import { checkBranch, planningHead, digest, git, gitOrNull, isPlanningPath, manifest, parseRecord, Registry, snapshot, worktrees, type Registration } from './index';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export type PlanningEdit = { project: Registration; path: string; content: string | null; expectedHead: string; expectedRevision: string | null; message: string; taskIds?: string[] };

function repository(path: string) {
  const location = realpathSync(path);
  const root = git(location, ['rev-parse', '--is-bare-repository']).trim() === 'true' ? location : realpathSync(git(location, ['rev-parse', '--show-toplevel']).trim());
  return { root, commonDir: realpathSync(resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim())) };
}
function commitMessage(subject: string, taskIds: string[]) {
  if (!subject.trim() || /[\r\n\0]/.test(subject) || subject.length > 200) throw new Error('Commit message must be a single non-empty line (maximum 200 characters)');
  if (taskIds.some(id => !idPattern.test(id))) throw new Error('Invalid task ID');
  return subject + (taskIds.length ? '\n\n' + [...new Set(taskIds)].map(id => `Task: ${id}`).join('\n') : '') + '\n';
}

/** Isolated index and immutable Git objects; never uses a code checkout or its index. */
function candidateCommit(commonDir: string, parent: string | null, files: Map<string, string | null>, message: string) {
  const temp = mkdtempSync(join(commonDir, 'alphabook-write-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(temp, 'index'), GIT_TERMINAL_PROMPT: '0' };
  const run = (args: string[], input?: string) => {
    const result = spawnSync('git', ['-C', commonDir, ...args], { encoding: 'utf8', input, env, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Git planning write failed');
    return result.stdout.trim();
  };
  try {
    run(parent ? ['read-tree', parent] : ['read-tree', '--empty']);
    for (const [path, content] of files) {
      if (!isPlanningPath(path) || /[\x00-\x1f\\:]/.test(path) || path.split('/').some(p => !p || ['.', '..', '.git'].includes(p))) throw new Error('Only safe branch-root planning file paths can be written');
      if (content === null) { run(['update-index', '--index-info'], `0 ${'0'.repeat(parent?.length || 40)}\t${path}\n`); continue; }
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('Planning text exceeds 2 MiB limit');
      const blob = run(['hash-object', '-w', '--stdin'], content);
      run(['update-index', '--add', '--cacheinfo', '100644', blob, path]);
    }
    const tree = run(['write-tree']);
    return run(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], message);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

function assertNotCheckedOut(project: Registration) {
  if (worktrees(project).some(t => t.branch === 'alphabook')) throw new Error('alphabook is checked out in a worktree. Commit there using ordinary Git, or release that checkout before direct branch writes. No checkout was modified.');
}

export function writePlanning(edit: PlanningEdit) {
  const { project, path, content, expectedRevision, expectedHead } = edit;
  assertNotCheckedOut(project);
  if (planningHead(project.commonDir) !== expectedHead) throw new Error('Conflict: alphabook advanced since your read. Re-read the plan and retry; nothing was changed.');
  const allowed = /^(tasks|decisions)\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.md$/.exec(path);
  if (!allowed && !/^(docs|artifacts)\/.+/.test(path)) throw new Error('Writes are limited to task/decision records, docs and artifacts');
  let previous: string | null = null;
  try { previous = git(project.commonDir, ['cat-file', 'blob', `${expectedHead}:${path}`]); } catch { /* File creation requires a null expected revision. */ }
  if ((previous === null ? null : digest(previous)) !== expectedRevision) throw new Error('Conflict: file revision differs from your read. Nothing was changed.');
  if (content === null && previous === null) throw new Error('Cannot delete a missing planning file');
  const taskIds = [...edit.taskIds || []];
  if (allowed) {
    const kind = allowed[1] === 'tasks' ? 'task' : 'decision';
    const parsed = parseRecord(content ?? previous!, path, kind);
    if (kind === 'task') taskIds.push(parsed.meta.id);
    if (previous !== null && content !== null) {
      const old = parseRecord(previous, path, kind);
      for (const key of Object.keys(old.meta.extensions || {})) if (!(key in (parsed.meta.extensions || {}))) throw new Error(`Preserve extension ${key} when replacing the record`);
    }
  }
  const candidate = candidateCommit(project.commonDir, expectedHead, new Map([[path, content]]), commitMessage(edit.message, taskIds));
  const state = snapshot(project, candidate);
  if (state.errors.length) throw new Error(`Invalid planning change (not published): ${state.errors.join('; ')}`);
  for (const id of taskIds) if (!state.tasks.some(t => t.meta.id === id) && !(content === null && allowed?.[1] === 'tasks' && allowed[2] === id)) throw new Error(`Unknown task trailer ${id}; planning change not published`);
  // update-ref performs the compare-and-swap under Git's own ref lock.
  try { git(project.commonDir, ['update-ref', '-m', edit.message, 'refs/heads/alphabook', candidate, expectedHead]); }
  catch { throw new Error('Conflict: another writer advanced alphabook. Re-read and retry; your change was not published.'); }
  return { committed: true, head: candidate, previousHead: expectedHead, path, deleted: content === null, revision: content === null ? null : digest(content) };
}

/** Creates an independent root commit, without switching HEAD or copying any code. */
export function initializeProject(path: string, name: string, options: { codeBranch?: string; home?: string } = {}) {
  const repo = repository(path);
  if (gitOrNull(repo.commonDir, ['show-ref', '--verify', 'refs/heads/alphabook'])) throw new Error('alphabook already exists; register the project instead');
  const codeBranch = options.codeBranch || gitOrNull(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || undefined;
  if (codeBranch) checkBranch(repo.commonDir, codeBranch);
  const data = { format: 'alphabook', format_version: '1.0', id: randomUUID(), name, planning_branch: 'alphabook', ...(codeBranch ? { code_branch: codeBranch } : {}) };
  const text = stringify(data);
  manifest(text, repo.commonDir);
  const commit = candidateCommit(repo.commonDir, null, new Map([['project.yaml', text]]), 'Initialize shared project planning\n');
  const provisional: Registration = { ...repo, id: digest(repo.commonDir).slice(0, 20), projectId: data.id, name, planningBranch: 'alphabook' };
  const state = snapshot(provisional, commit);
  if (state.errors.length) throw new Error(state.errors.join('; '));
  git(repo.commonDir, ['update-ref', '-m', 'Initialize shared planning', 'refs/heads/alphabook', commit, '0'.repeat(commit.length)]);
  return { project: new Registry(options.home).register(repo.root), head: commit };
}

/** Explicit import for migration; creates a new orphan ref, never deletes source files. */
export function importPlanning(path: string, files: Map<string, string>, message: string, taskIds: string[] = []) {
  const repo = repository(path);
  if (gitOrNull(repo.commonDir, ['show-ref', '--verify', 'refs/heads/alphabook'])) throw new Error('Refusing to overwrite existing alphabook branch');
  const info = manifest(files.get('project.yaml') || '', repo.commonDir);
  const candidate = candidateCommit(repo.commonDir, null, files, commitMessage(message, taskIds));
  const project: Registration = { ...repo, id: digest(repo.commonDir).slice(0, 20), projectId: info.id, name: info.name, planningBranch: 'alphabook' };
  const state = snapshot(project, candidate);
  if (state.errors.length) throw new Error(`Import invalid; source untouched: ${state.errors.join('; ')}`);
  git(repo.commonDir, ['update-ref', '-m', message, 'refs/heads/alphabook', candidate, '0'.repeat(candidate.length)]);
  return { project, head: candidate };
}
