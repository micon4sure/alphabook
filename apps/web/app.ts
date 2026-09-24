import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { DocumentFile, RecordFile, Registration } from '../../packages/core/index';
import type { Overview } from '../../packages/core/overview';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const label = (status: string) => status.replaceAll('_', ' ');
const pill = (status: string) => `<span class="pill ${escape(status)}">${escape(label(status))}</span>`;
let projects: Registration[] = [], state: Overview | null = null;
let projectId = localStorage.getItem('command.project') || '';
const query = new URLSearchParams(location.search);
let tab = ['tasks', 'graph', 'decisions', 'docs', 'artifacts', 'worktrees'].includes(query.get('tab') || '') ? query.get('tab')! : 'tasks';
let selected = query.get('record') || '', filter = 'all', serial = 0, detailSerial = 0, refreshing = false;
let editorBase: { head: string; revision: string | null; projectId: string } | null = null;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function showError(error: unknown) { $('error').textContent = error instanceof Error ? error.message : String(error); $('error').hidden = false; }
function projectUrl(suffix: string) { return `/api/projects/${projectId}/${suffix}`; }
function markdown(text: string) {
  const fragment = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'img', 'input', 'form', 'button'], FORBID_ATTR: ['style', 'id', 'name'] });
  fragment.querySelectorAll('a').forEach(a => {
    if (/^https?:\/\//i.test(a.getAttribute('href') || '')) { a.target = '_blank'; a.rel = 'noreferrer noopener'; }
    else { a.title = a.getAttribute('href') || ''; a.removeAttribute('href'); }
  });
  const container = document.createElement('div'); container.append(fragment); return container.innerHTML;
}
async function loadProjects() {
  projects = (await api<{ projects: Registration[] }>('/api/projects')).projects;
  if (!projects.some(p => p.id === projectId)) projectId = projects[0]?.id || '';
  $('project').innerHTML = projects.length ? projects.map(p => `<option value="${p.id}">${escape(p.name)}</option>`).join('') : '<option value="">No projects registered</option>';
  $<HTMLSelectElement>('project').value = projectId;
  $('empty').hidden = Boolean(projectId); $('project-view').hidden = !projectId;
  if (projectId) { localStorage.setItem('command.project', projectId); await refresh(true); }
}
async function refresh(force = false) {
  if (!projectId) return;
  const ticket = ++serial, requestedProject = projectId;
  refreshing = true;
  try {
    const next = await api<Overview>(projectUrl('overview'));
    if (ticket !== serial || projectId !== requestedProject) return;
    $('error').hidden = true;
    if (force || next.revision !== state?.revision) { state = next; render(); }
    $('sync-note').textContent = `Files checked ${new Date().toLocaleTimeString()} · Auto-refresh every 4s`;
  } catch (error) {
    if (ticket !== serial) return;
    state = null;
    $('project-name').textContent = projects.find(p => p.id === projectId)?.name || '';
    $('project-path').textContent = projects.find(p => p.id === projectId)?.root || '';
    $('context').textContent = 'Snapshot unavailable';
    $('metrics').innerHTML = ''; $('diagnostics').innerHTML = ''; $('task-count').textContent = '';
    $('view-note').textContent = 'This project needs a valid RPF 0.2 plan committed to its command branch. No planning checkout is required.';
    $('activity-strip').innerHTML = '';
    $('content').innerHTML = '<div class="empty-state">This snapshot cannot be read. No cached task state is being shown.</div>';
    showError(error);
  } finally { if (ticket === serial) refreshing = false; }
}
function render() {
  if (!state) return;
  $('project-name').textContent = state.project.name;
  $('project-path').textContent = state.context.root;
  $('context').textContent = `${state.context.head.slice(0, 8)} · ${state.worktrees.length} code worktrees`;
  const dirtyPlanning = state.planningWorktrees.filter(t => t.dirty).length;
  $('view-note').textContent = 'One shared plan, read directly from command. Branches and commits connect tasks to code; no branch switching needed.' + (dirtyPlanning ? ` ${dirtyPlanning} planning checkout(s) have uncommitted edits, not yet published here.` : '');
  const active = state.worktrees.filter(t => t.tasks.some(task => ['in_progress', 'blocked', 'review'].includes(task.meta.status)));
  $('activity-strip').innerHTML = active.length ? `<section class="project-activity"><div class="activity-heading"><h2>Work in progress</h2><span class="hint">${active.length} worktrees · recorded task state, not agent presence</span></div><div class="activity-grid">${active.map(t => `<article class="activity-card"><span class="mono">${escape(t.branch || 'detached')}</span>${t.tasks.filter(task => ['in_progress', 'blocked', 'review'].includes(task.meta.status)).map(task => `<button class="activity-task" data-jump="${escape(task.meta.id)}"><span>${escape(task.meta.id)} · ${escape(task.meta.title)}</span>${pill(task.meta.status)}</button>`).join('')}</article>`).join('')}</div></section>` : '';

  const counts = [
    ['', state.tasks.length, 'project tasks'], ['ready', state.tasks.filter(t => t.ready).length, 'ready to start'],
    ['active', state.tasks.filter(t => t.meta.status === 'in_progress').length, 'in progress'], ['done', state.tasks.filter(t => t.meta.status === 'done').length, 'completed'],
  ];
  $('metrics').innerHTML = counts.map(([kind, count, title]) => `<div class="metric ${kind}"><b>${count}</b><span>${title}</span></div>`).join('');
  $('task-count').textContent = String(state.tasks.length);
  $('diagnostics').innerHTML = (state.errors.length ? `<details class="error" open><summary>${state.errors.length} planning validation issue(s)</summary><ul>${state.errors.map(e => `<li>${escape(e)}</li>`).join('')}</ul></details>` : '') + (state.warnings.length ? `<details class="notice"><summary>${state.warnings.length} local branch/worktree notice(s)</summary><ul>${state.warnings.map(escape).map(w => `<li>${w}</li>`).join('')}</ul></details>` : '');
  renderContent();
}
function empty(text: string) { return `<div class="empty-state">${escape(text)}</div>`; }
function renderContent() {
  detailSerial++;
  if (!state) return;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false'); });
  if (tab === 'worktrees') { renderWorktrees(); return; }
  if (tab === 'graph') {
    $('content').innerHTML = `<div class="panel"><div class="panel-heading"><h2>Dependencies, at a glance</h2><span class="hint">Prerequisite → dependent task</span></div>${graph()}<div class="graph-note">Select a task to see its definition. “Ready” means planned with every prerequisite done in the shared plan.</div></div>`;
    return;
  }
  const docs = tab === 'docs' || tab === 'artifacts';
  let rows = tab === 'decisions' ? state.decisions : state.tasks;
  if (tab === 'tasks') rows = rows.filter(r => filter === 'all' || filter === 'open' && !['done', 'cancelled'].includes(r.meta.status) || filter === 'ready' && r.ready);
  const files = tab === 'artifacts' ? state.artifacts : state.documents;
  const keys = docs ? files.map(f => f.path) : rows.map(r => r.meta.id);
  if (!keys.includes(selected)) selected = keys[0] || '';
  const titles: Record<string, string> = { tasks: 'Project task plan', decisions: 'Decisions & rationale', docs: 'Project documentation', artifacts: 'Evidence & artifacts' };
  const filterControl = tab === 'tasks' ? `<select id="task-filter" aria-label="Filter tasks"><option value="all" ${filter === 'all' ? 'selected' : ''}>All tasks</option><option value="open" ${filter === 'open' ? 'selected' : ''}>Open tasks</option><option value="ready" ${filter === 'ready' ? 'selected' : ''}>Ready to start</option></select>` : '';
  const list = docs ? files.map(f => `<button class="record-row ${selected === f.path ? 'selected' : ''}" data-record="${escape(f.path)}"><span class="record-main"><span class="record-id">${escape(f.path.split('/').slice(0, -1).join('/'))}</span><span class="record-title">${escape(f.path.split('/').pop())}</span></span><span class="hint">${Math.ceil(f.size / 1024)} KB</span></button>`).join('') : rows.map(row => `<button class="record-row ${selected === row.meta.id ? 'selected' : ''}" data-record="${escape(row.meta.id)}"><span class="record-main"><span class="record-id">${escape(row.meta.id)}</span><span class="record-title">${escape(row.meta.title)}</span>${row.meta.depends_on?.length ? `<small>After ${row.meta.depends_on.map(escape).join(', ')}</small>` : ''}${row.meta.branches?.length ? `<small class="branch-label">⑂ ${row.meta.branches.map(escape).join(' · ')}</small>` : ''}</span>${pill(row.ready ? 'ready' : row.meta.status)}</button>`).join('');
  $('content').innerHTML = `<div class="split"><div class="panel"><div class="panel-heading"><h2>${titles[tab]}</h2><div class="panel-tools">${filterControl}<button id="new-file">+ New</button></div></div><div class="list">${list || empty(docs ? `No ${tab === 'docs' ? 'documents' : 'artifacts'} in this snapshot yet.` : 'No records match this view.')}</div></div><aside class="panel detail" id="detail" aria-label="Selected record">${empty('Select a record to inspect its files and context.')}</aside></div>`;
  if (selected) {
    if (docs) renderDocument(files.find(f => f.path === selected)!);
    else renderRecord(rows.find(r => r.meta.id === selected)!);
  }
}
function renderDocument(file: DocumentFile) {
  $('detail').innerHTML = `<div class="detail-head"><span class="eyebrow">${tab === 'docs' ? 'DOCUMENTATION' : 'ARTIFACT'}</span><span class="hint">${file.size} bytes</span>${file.text === null ? '' : '<button id="edit-file">Edit</button>'}</div><h2>${escape(file.path.split('/').pop())}</h2>${file.text === null ? '<p class="hint">Binary artifact or unavailable LFS payload. Preview is unavailable.</p>' : file.path.endsWith('.md') ? `<div class="markdown">${markdown(file.text)}</div>` : `<div class="markdown"><pre>${escape(file.text)}</pre></div>`}<span class="detail-path mono">${escape(file.path)}<br>SHA-256 ${file.revision.slice(0, 16)}</span>`;
}
function renderRecord(row: RecordFile) {
  const { meta } = row;
  const linkIds = (values: string[], kind = 'tasks') => values.map(id => `<button data-jump="${escape(id)}" data-kind="${kind}">${escape(id)}</button>`).join('') || 'None';
  const info = [
    ...(meta.kind === 'task' ? [['Depends on', linkIds(meta.depends_on || [])], ['Decisions', linkIds(meta.decisions || [], 'decisions')], ['Assignee', escape(meta.assignee || 'Not assigned')]] : []),
    ...(meta.branches?.length ? [['Code branches', meta.branches.map(branch => `<span class="mono">${escape(branch)}</span>`).join('<br>')]] : []),
    ...(meta.commits?.length ? [['Recorded commits', meta.commits.map(hash => `<span class="mono">${escape(hash.slice(0, 12))}</span>`).join('<br>')]] : []),
    ...(meta.supersedes ? [['Supersedes', linkIds([meta.supersedes], 'decisions')]] : []),
    ...(meta.paths?.length ? [['Code / paths', meta.paths.map(path => `<span class="mono">${escape(path)}</span>`).join('<br>')]] : []),
    ...(meta.artifacts?.length ? [['Artifacts', meta.artifacts.map(path => `<span class="mono">${escape(path)}</span>`).join('<br>')]] : []),
  ];
  $('detail').innerHTML = `<div class="detail-head"><span class="eyebrow">${escape(meta.kind.toUpperCase())} / ${escape(meta.id)}</span><div>${pill(meta.status)} <button id="edit-file">Edit</button></div></div><h2>${escape(meta.title)}</h2>${info.length ? `<dl class="record-meta">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}<div class="markdown">${markdown(row.body)}</div>${meta.kind === 'task' ? '<section id="commits" class="commits"><h3>Linked commits</h3><p class="hint">Reading Git trailers…</p></section>' : ''}<span class="detail-path mono">${escape(row.path)}<br>SHA-256 ${row.revision.slice(0, 16)}</span>`;
  if (meta.kind === 'task') void loadCommits(meta.id);
}
async function loadCommits(id: string) {
  const ticket = ++detailSerial;
  try {
    const result = await api<{ commits: { hash: string; subject: string; kind: string }[]; scanned: number; truncated: boolean; recordedCommits: { hash: string; available: boolean }[] }>(projectUrl(`commits?task=${encodeURIComponent(id)}`));
    if (ticket !== detailSerial || !$('commits')) return;
    $('commits').innerHTML = `<h3>Linked commits</h3>${result.commits.map(c => `<div class="commit"><code title="${escape(c.hash)}">${c.hash.slice(0, 8)}</code><span>${escape(c.subject)} <span class="hint">· ${escape(c.kind)}</span></span></div>`).join('') || '<p class="hint">No matching Task trailers in the scanned history.</p>'}<p class="hint">${result.scanned} commits scanned across repository refs${result.truncated ? ' · Older history is not included' : ''}</p>`;
  } catch (error) { if (ticket === detailSerial && $('commits')) $('commits').textContent = error instanceof Error ? error.message : String(error); }
}
function graph() {
  if (!state?.tasks.length) return empty('Add task files to see their dependencies.');
  const map = new Map(state.tasks.map(r => [r.meta.id, r]));
  const memo = new Map<string, number>();
  function depth(id: string, active = new Set<string>()): number {
    if (active.has(id)) return 0;
    if (memo.has(id)) return memo.get(id)!;
    const row = map.get(id); if (!row) return 0;
    const parents = row.meta.depends_on || [];
    const result = parents.length ? 1 + Math.max(...parents.map(p => depth(p, new Set([...active, id])))) : 0;
    memo.set(id, result); return result;
  }
  const positions = new Map<string, { x: number; y: number }>(), counts: number[] = [];
  for (const row of state.tasks) {
    const column = depth(row.meta.id); const index = counts[column] || 0; counts[column] = index + 1;
    positions.set(row.meta.id, { x: 28 + column * 290, y: 25 + index * 112 });
  }
  const width = Math.max(690, counts.length * 290), height = Math.max(220, Math.max(...counts.filter(Number.isFinite)) * 112 + 45);
  const edges = state.tasks.flatMap(row => (row.meta.depends_on || []).flatMap(parent => {
    const start = positions.get(parent), end = positions.get(row.meta.id);
    return start && end ? [`<path class="graph-edge" marker-end="url(#arrow)" d="M${start.x + 230},${start.y + 41} C${start.x + 262},${start.y + 41} ${end.x - 32},${end.y + 41} ${end.x - 4},${end.y + 41}"/>`] : [];
  })).join('');
  const nodes = state.tasks.map(row => {
    const { x, y } = positions.get(row.meta.id)!;
    return `<g class="graph-node" tabindex="0" role="button" aria-label="Open ${escape(row.meta.id)}: ${escape(row.meta.title)}" data-graph="${escape(row.meta.id)}" transform="translate(${x},${y})"><title>${escape(row.meta.title)}</title><rect width="230" height="82" rx="5"/><text x="14" y="20" class="node-id">${escape(row.meta.id)}</text><text x="14" y="43">${escape(row.meta.title.length > 30 ? row.meta.title.slice(0, 29) + '…' : row.meta.title)}</text><text x="14" y="65" class="node-status">${escape(label(row.ready ? 'ready' : row.meta.status).toUpperCase())}</text></g>`;
  }).join('');
  return `<div class="graph-wrap"><svg width="${width}" height="${height}" role="group" aria-label="Task dependency graph"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path class="graph-arrow" d="M0 0 L10 5 L0 10Z"/></marker></defs>${edges}${nodes}</svg></div>`;
}
function renderWorktrees() {
  if (!state) return;
  $('content').innerHTML = `<div class="tree-grid">${state.worktrees.map(tree => `<article class="panel tree-card"><div class="detail-head"><span class="eyebrow">CODE WORKTREE</span>${pill(tree.dirty === null ? 'unavailable' : tree.dirty ? 'uncommitted' : 'clean')}</div><h2>${escape(tree.branch || tree.head?.slice(0, 8) || 'Unborn')}</h2><p class="path mono">${escape(tree.root)}</p>${tree.tasks.map(task => `<button class="activity-task" data-jump="${escape(task.meta.id)}"><span>${escape(task.meta.id)}<br>${escape(task.meta.title)}</span>${pill(task.meta.status)}</button>`).join('') || '<p class="hint">No tasks linked to this branch. Add its name to a task’s branches field.</p>'}${tree.error ? `<p class="error">${escape(tree.error)}</p>` : ''}</article>`).join('') || empty('No local code worktrees. The shared plan is still available without one.')}</div><h2 class="branch-heading">Other code branches</h2><div class="tree-grid">${state.branches.filter(branch => !branch.checkoutIds.length).map(branch => `<article class="panel tree-card"><span class="eyebrow">NO LOCAL WORKTREE</span><h2>${escape(branch.name)}</h2>${branch.tasks.map(task => `<button class="activity-task" data-jump="${escape(task.meta.id)}"><span>${escape(task.meta.id)} · ${escape(task.meta.title)}</span>${pill(task.meta.status)}</button>`).join('') || '<p class="hint">No tasks linked.</p>'}</article>`).join('') || '<p class="hint">Every local code branch has a worktree.</p>'}</div><p class="view-note">Task state comes only from command. Code worktrees provide branch, HEAD and dirty state—not separate task databases.</p>`;
}

function openEditor(create = false) {
  if (!state) return;
  const record = [...state.tasks, ...state.decisions].find(row => row.meta.id === selected);
  const file = [...state.documents, ...state.artifacts].find(row => row.path === selected);
  const id = `${tab === 'decisions' ? 'D' : 'T'}-${crypto.randomUUID()}`;
  const folder = tab === 'decisions' ? 'decisions' : tab === 'docs' ? 'docs' : tab === 'artifacts' ? 'artifacts' : 'tasks';
  const path = create ? `.command/${folder}/${folder === 'tasks' || folder === 'decisions' ? id : 'new-document'}.md` : record?.path || file?.path;
  if (!path) return;
  const content = create ? folder === 'tasks' || folder === 'decisions' ? `---\nkind: ${folder === 'tasks' ? 'task' : 'decision'}\nid: ${id}\ntitle: New ${folder === 'tasks' ? 'task' : 'decision'}\nstatus: ${folder === 'tasks' ? 'planned' : 'proposed'}\n---\n\nDescribe the outcome and acceptance criteria.\n` : '# New document\n' : record?.content ?? file?.text ?? '';
  editorBase = { head: state.context.head, revision: create ? null : record?.revision || file!.revision, projectId };
  $<HTMLInputElement>('editor-path').value = path;
  $<HTMLInputElement>('editor-path').readOnly = !create;
  $<HTMLTextAreaElement>('editor-content').value = content;
  $<HTMLInputElement>('editor-message').value = `${create ? 'Add' : 'Update'} ${path.split('/').pop()}`;
  $('editor-title').textContent = create ? 'Create planning file' : 'Edit planning file';
  $('editor-error').hidden = true; $('editor-delete').hidden = create;
  $<HTMLDialogElement>('editor-dialog').showModal();
}
async function saveEditor(remove = false) {
  if (!editorBase) return;
  if (remove && !confirm('Delete this planning file in a new command commit? Git history retains the old content. Prefer cancelling completed/historical tasks.')) return;
  const buttons = document.querySelectorAll<HTMLButtonElement>('#editor-dialog button');
  buttons.forEach(button => button.disabled = true);
  try {
    await api(`/api/projects/${editorBase.projectId}/planning`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-command-write': '1' },
      body: JSON.stringify({ path: $<HTMLInputElement>('editor-path').value, content: remove ? null : $<HTMLTextAreaElement>('editor-content').value, expectedHead: editorBase.head, expectedRevision: editorBase.revision, message: $<HTMLInputElement>('editor-message').value }),
    });
    $<HTMLDialogElement>('editor-dialog').close(); await refresh(true);
  } catch (error) { $('editor-error').textContent = error instanceof Error ? error.message : String(error); $('editor-error').hidden = false; }
  finally { buttons.forEach(button => button.disabled = false); }
}
$('editor-form').onsubmit = event => { event.preventDefault(); void saveEditor(); };
$('editor-close').onclick = () => $<HTMLDialogElement>('editor-dialog').close();
$('editor-delete').onclick = () => { void saveEditor(true); };

function openRegistration() { $('register-error').hidden = true; $<HTMLDialogElement>('register-dialog').showModal(); $<HTMLInputElement>('register-path').focus(); }
$('register-open').onclick = openRegistration; $('empty-register').onclick = openRegistration;
$('register-close').onclick = () => $<HTMLDialogElement>('register-dialog').close();
$('register-form').onsubmit = async event => {
  event.preventDefault(); const button = document.querySelector<HTMLButtonElement>('#register-form button[type="submit"]')!; button.disabled = true;
  try {
    const result = await api<{ project: Registration }>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-command-write': '1' }, body: JSON.stringify({ path: $<HTMLInputElement>('register-path').value.trim() }) });
    projectId = result.project.id; selected = ''; state = null;
    $<HTMLDialogElement>('register-dialog').close(); await loadProjects();
  } catch (error) { $('register-error').textContent = error instanceof Error ? error.message : String(error); $('register-error').hidden = false; }
  finally { button.disabled = false; }
};
$('project').onchange = async () => { projectId = $<HTMLSelectElement>('project').value; state = null; selected = ''; localStorage.setItem('command.project', projectId); await refresh(true); };
$('refresh').onclick = () => { void refresh(true); };
$('unregister').onclick = async () => {
  if (!confirm('Remove this local registration? Repository files and Git history will not be changed.')) return;
  try { await api(`/api/projects/${projectId}`, { method: 'DELETE', headers: { 'x-command-write': '1' } }); projectId = ''; state = null; await loadProjects(); } catch (error) { showError(error); }
};
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.onclick = () => { tab = button.dataset.tab!; selected = ''; renderContent(); });
$('content').addEventListener('change', event => { if ((event.target as HTMLElement).id === 'task-filter') { filter = (event.target as HTMLSelectElement).value; renderContent(); } });
function handleRecordClick(event: Event) {
  const element = (event.target as Element).closest<HTMLElement>('button,[data-graph]');
  if (element?.id === 'edit-file' || element?.id === 'new-file') { openEditor(element.id === 'new-file'); return; }
  const target = (event.target as Element).closest<HTMLElement>('[data-record],[data-jump],[data-graph]'); if (!target) return;
  if (target.dataset.graph || target.dataset.jump) { selected = target.dataset.graph || target.dataset.jump!; tab = target.dataset.kind || 'tasks'; filter = 'all'; }
  else selected = target.dataset.record!;
  renderContent();
}
$('content').addEventListener('click', handleRecordClick);
$('activity-strip').addEventListener('click', handleRecordClick);
$('content').addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && (event.target as HTMLElement).matches('[data-graph]')) { event.preventDefault(); (event.target as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
void loadProjects().catch(showError);
setInterval(() => { if (!document.hidden && !refreshing && !$<HTMLDialogElement>('register-dialog').open && !$<HTMLDialogElement>('editor-dialog').open) void refresh(); }, 4000);
