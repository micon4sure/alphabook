import { digest, git, gitOrNull, isPlanningRef, message, snapshot, worktrees, type RecordFile, type Registration, type Snapshot, type Worktree } from './index';

export type ProjectWorktree = Worktree & { dirty: boolean | null; tasks: RecordFile[]; error?: string };
export type CodeBranch = { name: string; head: string; tasks: RecordFile[]; checkoutIds: string[] };
export type Overview = Snapshot & { worktrees: ProjectWorktree[]; planningWorktrees: ProjectWorktree[]; branches: CodeBranch[]; warnings: string[] };

/** One command-branch plan joined to every local code branch/worktree by explicit task links. */
export function overview(project: Registration): Overview {
  const plan = snapshot(project);
  const warnings: string[] = [];
  const trees: ProjectWorktree[] = worktrees(project).map(tree => {
    let dirty: boolean | null = null, error: string | undefined;
    try { if (!tree.available) throw new Error('Worktree directory unavailable'); dirty = Boolean(git(tree.root, ['status', '--porcelain=v1', '-z'])); }
    catch (err) { error = message(err); warnings.push(`${tree.branch || tree.root}: ${error}`); }
    const tasks = tree.role === 'planning' ? [] : plan.tasks.filter(task => tree.branch ? task.meta.branches?.includes(tree.branch) : Boolean(tree.head && task.meta.commits?.includes(tree.head)));
    return { ...tree, dirty, tasks, ...(error ? { error } : {}) };
  });
  const branches: CodeBranch[] = git(project.commonDir, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads/']).trim().split('\n').filter(Boolean).flatMap(line => {
    const [name, head] = line.split('\0');
    if (isPlanningRef(project.commonDir, head, name)) return [];
    return [{ name, head, tasks: plan.tasks.filter(task => task.meta.branches?.includes(name)), checkoutIds: trees.filter(t => t.branch === name && t.role === 'code').map(t => t.id) }];
  });
  for (const task of plan.tasks) for (const branch of task.meta.branches || []) if (!branches.some(b => b.name === branch)) warnings.push(`${task.meta.id}: linked code branch ${branch} is not present locally`);
  for (const task of plan.tasks) for (const commit of task.meta.commits || []) if (!gitOrNull(project.commonDir, ['cat-file', '-t', commit])) warnings.push(`${task.meta.id}: recorded code commit ${commit.slice(0, 12)} is not available locally`);
  const data = { ...plan, worktrees: trees.filter(t => t.role === 'code'), planningWorktrees: trees.filter(t => t.role === 'planning'), branches, warnings, revision: '' };
  return { ...data, revision: digest(JSON.stringify(data)) };
}
