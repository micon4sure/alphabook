import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { isAlias, isMap, isScalar, parseDocument, visit } from 'yaml';
import schema from '../../schemas/0.1/schema.json' with { type: 'json' };

export type Manifest = { format: 'repo-project'; format_version: '0.1'; id: string; name: string; integration_branch: string };
export type TaskStatus = 'planned' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type Metadata = { kind: 'task' | 'decision'; id: string; title: string; status: string; depends_on?: string[]; decisions?: string[]; paths?: string[]; artifacts?: string[]; assignee?: string; supersedes?: string; extensions?: Record<string, unknown> };
export type RecordFile = { meta: Metadata; body: string; path: string; revision: string; ready?: boolean };
export type DocumentFile = { path: string; revision: string; text: string | null; size: number };
export type Registration = { id: string; root: string; commonDir: string; projectId: string; name: string; integrationBranch: string };
export type Worktree = { id: string; root: string; head: string | null; branch: string | null; locked: boolean; prunable: boolean; available: boolean };
export type Snapshot = {
  project: Manifest; context: { source: 'checkout' | 'accepted'; checkoutId: string; root: string; branch: string | null; head: string | null; dirty: boolean };
  tasks: RecordFile[]; decisions: RecordFile[]; documents: DocumentFile[]; artifacts: DocumentFile[]; errors: string[]; revision: string;
};
const LIMIT = 2 * 1024 * 1024;
export const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const localId = (path: string) => digest(path).slice(0, 20);
export const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = Object.fromEntries(['project', 'task', 'decision'].map(kind => [kind, ajv.compile({ $defs: schema.$defs, $ref: `#/$defs/${kind}` })]));

export function git(root: string, args: string[], input?: string): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', input, timeout: 10_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Git command failed');
  return result.stdout;
}
function gitOrNull(root: string, args: string[]) { try { return git(root, args).trim() || null; } catch { return null; } }

export function metadata(text: string): unknown {
  if (text.startsWith('\uFEFF')) throw new Error('UTF-8 BOM is not allowed');
  const doc = parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true, strict: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('; '));
  visit(doc, (_, node) => {
    if (isAlias(node) || (node && typeof node === 'object' && ('anchor' in node && node.anchor || 'tag' in node && node.tag))) throw new Error('anchors, aliases and explicit tags are not allowed');
    if (isMap(node)) for (const pair of node.items) if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('metadata keys must be strings');
    if (isScalar(node) && typeof node.value === 'number' && !Number.isFinite(node.value)) throw new Error('metadata numbers must be finite');
  });
  const value = doc.toJS();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('metadata must be an object');
  return value;
}
function check(value: unknown, kind: string) {
  if (!validators[kind](value)) throw new Error(ajv.errorsText(validators[kind].errors));
}
export function parseRecord(text: string, path: string, kind: 'task' | 'decision'): RecordFile {
  const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(text);
  if (!match || match.index !== 0) throw new Error('record must start with closed YAML frontmatter');
  const meta = metadata(match[1]) as Metadata;
  check(meta, kind);
  if (basename(path, '.md') !== meta.id) throw new Error('filename must match record ID');
  return { meta, body: text.slice(match[0].length), path, revision: digest(text) };
}
function manifest(text: string, root: string): Manifest {
  const data = metadata(text) as Manifest;
  check(data, 'project');
  if (data.integration_branch === 'HEAD' || data.integration_branch.startsWith('-')) throw new Error('invalid integration branch');
  git(root, ['check-ref-format', `refs/heads/${data.integration_branch}`]);
  return data;
}

function safeRelative(path: string) {
  if (!path || isAbsolute(path) || /[:\\\x00-\x1f]/.test(path) || path.split('/').some(part => !part || ['.', '..', '.git'].includes(part))) throw new Error(`unsafe project path: ${path}`);
}
/** Check existing ancestors too, so a missing target cannot hide a symlink escape. */
export function contained(root: string, path: string): string {
  safeRelative(path);
  let current = root;
  for (const segment of path.split('/')) {
    current = join(current, segment);
    // realpath on a dangling symlink throws instead of accepting it.
    try {
      const real = realpathSync(current);
      if (real !== root && !real.startsWith(root + sep)) throw new Error(`path escapes project: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // lstat distinguishes an absent path from a dangling symlink.
      const parent = dirname(current);
      if (existsSync(parent) && readdirSync(parent, { withFileTypes: true }).some(e => e.name === basename(current) && e.isSymbolicLink())) throw new Error(`dangling symlink: ${path}`);
    }
  }
  return join(root, path);
}
function localBytes(root: string, path: string): Buffer {
  const target = contained(root, path);
  if (!statSync(target).isFile()) throw new Error(`not a regular file: ${path}`);
  if (statSync(target).size > LIMIT) throw new Error(`file exceeds 2 MiB reader limit: ${path}`);
  return readFileSync(target);
}
function utf8(bytes: Buffer): string { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }

export function commandHome() { return resolve(process.env.COMMAND_HOME || join(homedir(), '.local/share/command')); }
export class Registry {
  constructor(public home = commandHome()) {}
  list(): Registration[] {
    const path = join(this.home, 'projects.json');
    if (!existsSync(path)) return [];
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(rows) || rows.some(row => !row || ['id', 'root', 'commonDir', 'projectId', 'name', 'integrationBranch'].some(key => typeof row[key] !== 'string'))) throw new Error('Invalid local project registry');
    return rows;
  }
  get(id: string): Registration {
    const result = this.list().find(item => item.id === id);
    if (!result) throw new Error('Project is not registered');
    return result;
  }
  register(path: string): Registration {
    if (!isAbsolute(path)) throw new Error('Use an absolute project or .command directory path');
    const target = realpathSync(path);
    const root = realpathSync(git(target, ['rev-parse', '--show-toplevel']).trim());
    const project = manifest(utf8(localBytes(root, '.command/project.yaml')), root);
    const commonDir = realpathSync(resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim()));
    const item = { id: localId(commonDir), root, commonDir, projectId: project.id, name: project.name, integrationBranch: project.integration_branch };
    this.change(rows => [...rows.filter(row => row.id !== item.id), item]);
    return item;
  }
  unregister(id: string) { this.change(rows => rows.filter(row => row.id !== id)); }
  private change(update: (rows: Registration[]) => Registration[]) {
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    const lock = join(this.home, 'registry.lock');
    let fd: number;
    try { fd = openSync(lock, 'wx', 0o600); } catch { throw new Error('Registry is busy (registry.lock); retry after the other writer finishes'); }
    const temp = join(this.home, `projects-${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, JSON.stringify(update(this.list()), null, 2) + '\n', { mode: 0o600 });
      renameSync(temp, join(this.home, 'projects.json'));
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
      closeSync(fd); unlinkSync(lock);
    }
  }
}

export function worktrees(project: Registration): Worktree[] {
  // Use the common Git directory so registration survives removal of a linked checkout.
  const raw = git(project.commonDir, ['worktree', 'list', '--porcelain', '-z']);
  return raw.split('\0\0').filter(Boolean).flatMap(block => {
    const fields = block.split('\0');
    const root = fields.find(s => s.startsWith('worktree '))?.slice(9);
    if (!root || fields.includes('bare')) return [];
    const branch = fields.find(s => s.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') || null;
    return [{ id: localId(root), root, branch, head: fields.find(s => s.startsWith('HEAD '))?.slice(5) || null, locked: fields.some(s => s.startsWith('locked')), prunable: fields.some(s => s.startsWith('prunable')), available: existsSync(root) }];
  });
}

export function snapshot(project: Registration, checkoutId: string, source: 'checkout' | 'accepted' = 'checkout'): Snapshot {
  const tree = worktrees(project).find(w => w.id === checkoutId && w.available);
  if (!tree) throw new Error('Checkout is unavailable or does not belong to this project');
  const root = realpathSync(tree.root);
  const head = source === 'accepted' ? git(root, ['rev-parse', '--verify', `refs/heads/${project.integrationBranch}^{commit}`]).trim() : gitOrNull(root, ['rev-parse', '--verify', 'HEAD']);
  const errors: string[] = [];
  const modes = new Map<string, string>();
  if (source === 'accepted') {
    for (const entry of git(root, ['ls-tree', '-rz', head!]).split('\0').filter(Boolean)) {
      const split = entry.indexOf('\t');
      modes.set(entry.slice(split + 1), entry.slice(0, 6));
    }
  }
  const bytes = (path: string): Buffer => {
    safeRelative(path);
    if (source === 'checkout') return localBytes(root, path);
    if (!modes.get(path)?.startsWith('100')) throw new Error(`missing or unsupported non-regular Git file: ${path}`);
    const size = Number(git(root, ['cat-file', '-s', `${head}:${path}`]));
    if (size > LIMIT) throw new Error(`file exceeds 2 MiB reader limit: ${path}`);
    const result = spawnSync('git', ['-C', root, 'cat-file', 'blob', `${head}:${path}`], { timeout: 10_000, maxBuffer: LIMIT });
    if (result.error || result.status !== 0) throw new Error(`Cannot read Git blob: ${path}`);
    return result.stdout;
  };
  const list = (folder: string, recursive = false): string[] => {
    if (source === 'accepted') return [...modes.keys()].filter(path => path.startsWith(folder + '/') && (recursive || !path.slice(folder.length + 1).includes('/')));
    const directory = contained(root, folder);
    if (!existsSync(directory)) return [];
    const result: string[] = [];
    const walk = (dir: string, seen: Set<string>) => {
      const full = contained(root, dir);
      const canonical = realpathSync(full);
      if (seen.has(canonical)) throw new Error(`symlink directory cycle: ${dir}`);
      const nextSeen = new Set([...seen, canonical]);
      for (const entry of readdirSync(full, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        const target = contained(root, path);
        if (statSync(target).isDirectory()) { if (recursive) walk(path, nextSeen); }
        else result.push(path);
        if (result.length > 5000) throw new Error('Folder exceeds 5000 file reader limit');
      }
    };
    walk(folder, new Set());
    return result.sort();
  };
  const readManifest = manifest(utf8(bytes('.command/project.yaml')), root);
  if (readManifest.id !== project.projectId) throw new Error('Snapshot project identity differs from registration');
  const records = (kind: 'task' | 'decision'): RecordFile[] => {
    const result: RecordFile[] = [];
    try {
      for (const path of list(`.command/${kind}s`).filter(path => path.endsWith('.md'))) {
        try { result.push(parseRecord(utf8(bytes(path)), path, kind)); }
        catch (error) { errors.push(`${path}: ${message(error)}`); }
      }
    } catch (error) { errors.push(message(error)); }
    return result;
  };
  const tasks = records('task'), decisions = records('decision');
  const ids = new Set<string>();
  for (const record of [...tasks, ...decisions]) {
    if (ids.has(record.meta.id)) errors.push(`Duplicate record ID: ${record.meta.id}`);
    ids.add(record.meta.id);
    for (const path of [...record.meta.paths || [], ...record.meta.artifacts || []]) {
      try {
        safeRelative(path);
        if (source === 'checkout') contained(root, path);
        else for (const [p, mode] of modes) if (mode === '120000' && (path === p || path.startsWith(p + '/'))) throw new Error(`Git symlink not followed: ${p}`);
      } catch (error) { errors.push(`${record.meta.id}: ${message(error)}`); }
    }
    for (const path of record.meta.artifacts || []) try {
      if (source === 'checkout' ? !statSync(contained(root, path)).isFile() : !modes.get(path)?.startsWith('100')) throw new Error('artifact is not a regular file');
    } catch (error) { errors.push(`${record.meta.id}: missing/invalid artifact ${path}: ${message(error)}`); }
  }
  const taskMap = new Map(tasks.map(t => [t.meta.id, t]));
  const decisionMap = new Map(decisions.map(d => [d.meta.id, d]));
  const graph = (rows: RecordFile[], field: 'depends_on' | 'supersedes') => {
    const map = new Map(rows.map(r => [r.meta.id, r]));
    const seen = new Set<string>(), active = new Set<string>();
    const visitNode = (id: string) => {
      if (active.has(id)) throw new Error(`cycle in ${field} graph`);
      if (seen.has(id)) return;
      const row = map.get(id);
      if (!row) throw new Error(`missing ${field} target ${id}`);
      active.add(id);
      const value = row.meta[field];
      for (const target of typeof value === 'string' ? [value] : value || []) visitNode(target);
      active.delete(id); seen.add(id);
    };
    try { for (const id of map.keys()) visitNode(id); } catch (error) { errors.push(message(error)); }
  };
  graph(tasks, 'depends_on'); graph(decisions, 'supersedes');
  for (const task of tasks) {
    task.ready = task.meta.status === 'planned' && (task.meta.depends_on || []).every(id => taskMap.get(id)?.meta.status === 'done');
    for (const id of task.meta.decisions || []) if (!decisionMap.has(id)) errors.push(`${task.meta.id}: missing decision ${id}`);
  }
  const documents = (folder: string): DocumentFile[] => {
    const result: DocumentFile[] = [];
    try { for (const path of list(folder, true)) {
      try {
        const data = bytes(path);
        let text: string | null = null;
        try { const decoded = utf8(data); if (!decoded.includes('\0')) text = decoded; } catch { /* Binary files remain listed, never interpreted as HTML. */ }
        result.push({ path, text, size: data.length, revision: digest(data) });
      } catch (error) { errors.push(`${path}: ${message(error)}`); }
    } } catch (error) { errors.push(message(error)); }
    return result;
  };
  const data = {
    project: readManifest,
    context: { source, checkoutId, root, branch: source === 'accepted' ? project.integrationBranch : tree.branch, head, dirty: source === 'checkout' && Boolean(git(root, ['status', '--porcelain=v1', '-z'])) },
    tasks, decisions, documents: documents('.command/docs'), artifacts: documents('.command/artifacts'), errors,
  };
  if (errors.length) for (const task of tasks) task.ready = false;
  return { ...data, revision: digest(JSON.stringify(data)) };
}

export function taskCommits(project: Registration, checkoutId: string, taskId: string, source: 'checkout' | 'accepted' = 'checkout', limit = 100) {
  const state = snapshot(project, checkoutId, source);
  if (!state.tasks.some(t => t.meta.id === taskId)) throw new Error('Task does not exist in selected snapshot');
  if (!state.context.head) return { commits: [], scanned: 0, truncated: false };
  const logs = git(state.context.root, ['log', `--max-count=${limit + 1}`, '--format=%H%x00%s%x00%B%x00', state.context.head, '--']).split('\0');
  const commits: { hash: string; subject: string; tasks: string[] }[] = [];
  let scanned = 0, truncated = false;
  for (let i = 0; i + 2 < logs.length; i += 3) {
    if (scanned === limit) { truncated = true; break; }
    const hash = logs[i].trim(), subject = logs[i + 1], body = logs[i + 2];
    const trailers = git(state.context.root, ['interpret-trailers', '--parse'], body);
    const tasks = trailers.split('\n').flatMap(line => /^task:\s*(\S+)\s*$/i.exec(line)?.[1] || []);
    if (tasks.includes(taskId)) commits.push({ hash, subject, tasks });
    scanned++;
  }
  return { commits, scanned, truncated };
}
