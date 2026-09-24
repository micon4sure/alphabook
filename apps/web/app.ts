import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { DocumentFile, RecordFile, Registration, Snapshot, Worktree } from '../../packages/core/index';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const label = (status: string) => status.replaceAll('_', ' ');
const pill = (status: string) => `<span class="pill ${escape(status)}">${escape(label(status))}</span>`;
let projects: Registration[] = [], trees: Worktree[] = [], state: Snapshot | null = null;
let projectId = localStorage.getItem('command.project') || '', checkoutId = '', source: 'accepted' | 'checkout' = 'accepted';
let tab = 'tasks', selected = '', filter = 'all', serial = 0, detailSerial = 0, refreshing = false;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function showError(error: unknown) { $('error').textContent = error instanceof Error ? error.message : String(error); $('error').hidden = false; }
function projectUrl(suffix: string) { return `/api/projects/${projectId}/${suffix}`; }
function contextQuery() { return `checkout=${encodeURIComponent(checkoutId)}&source=${source}`; }
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
    const result = await api<{ worktrees: Worktree[] }>(projectUrl('worktrees'));
    if (ticket !== serial || projectId !== requestedProject) return;
    trees = result.worktrees;
    if (!trees.some(t => t.id === checkoutId && t.available)) checkoutId = trees.find(t => t.available && t.branch === projects.find(p => p.id === projectId)?.integrationBranch)?.id || trees.find(t => t.available)?.id || '';
    $('checkout').innerHTML = trees.map(t => `<option value="${t.id}" ${!t.available ? 'disabled' : ''}>${escape(t.branch || 'detached')} · ${escape(t.root.split('/').pop())}${!t.available ? ' (unavailable)' : ''}</option>`).join('');
    $<HTMLSelectElement>('checkout').value = checkoutId;
    const next = await api<Snapshot>(projectUrl(`snapshot?${contextQuery()}`));
    if (ticket !== serial || projectId !== requestedProject) return;
    $('error').hidden = true;
    if (force || next.revision !== state?.revision) { state = next; render(); }
    else if (tab === 'worktrees') await renderWorktrees();
    $('sync-note').textContent = `Files checked ${new Date().toLocaleTimeString()} · Auto-refresh every 4s`;
  } catch (error) {
    if (ticket !== serial) return;
    state = null;
    $('project-name').textContent = projects.find(p => p.id === projectId)?.name || '';
    $('project-path').textContent = projects.find(p => p.id === projectId)?.root || '';
    $('context').textContent = 'Snapshot unavailable';
    $('metrics').innerHTML = ''; $('diagnostics').innerHTML = ''; $('task-count').textContent = '';
    $('view-note').textContent = source === 'accepted' ? 'The accepted branch must contain a committed .command plan. You can switch to Checkout files to inspect uncommitted planning.' : 'Fix the reported file or registration error, then refresh.';
    $('content').innerHTML = '<div class="empty-state">This snapshot cannot be read. No cached task state is being shown.</div>';
    showError(error);
  } finally { if (ticket === serial) refreshing = false; }
}
function render() {
  if (!state) return;
  $('project-name').textContent = state.project.name;
  $('project-path').textContent = state.context.root;
  $('context').textContent = `${state.context.head?.slice(0, 8) || 'No commits'} · ${state.context.dirty ? 'Uncommitted changes' : source === 'accepted' ? 'Committed snapshot' : 'Clean checkout'}`;
  $('view-note').textContent = source === 'accepted' ? `Accepted plan from ${state.context.branch}. Task branch progress becomes accepted through an ordinary Git merge, rebase or cherry-pick.` : 'Live files from this checkout, including uncommitted edits. A task marked done here is not necessarily integrated into the accepted plan.';
  const counts = [
    ['', state.tasks.length, 'tasks in this view'], ['ready', state.tasks.filter(t => t.ready).length, 'ready to start'],
    ['active', state.tasks.filter(t => t.meta.status === 'in_progress').length, 'in progress'], ['done', state.tasks.filter(t => t.meta.status === 'done').length, 'completed'],
  ];
  $('metrics').innerHTML = counts.map(([kind, count, title]) => `<div class="metric ${kind}"><b>${count}</b><span>${title}</span></div>`).join('');
  $('task-count').textContent = String(state.tasks.length);
  $('diagnostics').innerHTML = state.errors.length ? `<details class="error" open><summary>${state.errors.length} planning validation issue(s)</summary><ul>${state.errors.map(e => `<li>${escape(e)}</li>`).join('')}</ul></details>` : '';
  renderContent();
}
function empty(text: string) { return `<div class="empty-state">${escape(text)}</div>`; }
function renderContent() {
  detailSerial++;
  if (!state) return;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false'); });
  if (tab === 'worktrees') { void renderWorktrees().catch(showError); return; }
  if (tab === 'graph') {
    $('content').innerHTML = `<div class="panel"><div class="panel-heading"><h2>Dependencies, at a glance</h2><span class="hint">Prerequisite → dependent task</span></div>${graph()}<div class="graph-note">Select a task to see its definition. “Ready” means planned with every prerequisite done in this snapshot.</div></div>`;
    return;
  }
  const docs = tab === 'docs' || tab === 'artifacts';
  let rows = tab === 'decisions' ? state.decisions : state.tasks;
  if (tab === 'tasks') rows = rows.filter(r => filter === 'all' || filter === 'open' && !['done', 'cancelled'].includes(r.meta.status) || filter === 'ready' && r.ready);
  const files = tab === 'artifacts' ? state.artifacts : state.documents;
  const keys = docs ? files.map(f => f.path) : rows.map(r => r.meta.id);
  if (!keys.includes(selected)) selected = keys[0] || '';
  const titles: Record<string, string> = { tasks: 'Work to be done', decisions: 'Decisions & rationale', docs: 'Project documentation', artifacts: 'Evidence & artifacts' };
  const filterControl = tab === 'tasks' ? `<select id="task-filter" aria-label="Filter tasks"><option value="all" ${filter === 'all' ? 'selected' : ''}>All tasks</option><option value="open" ${filter === 'open' ? 'selected' : ''}>Open tasks</option><option value="ready" ${filter === 'ready' ? 'selected' : ''}>Ready to start</option></select>` : '';
  const list = docs ? files.map(f => `<button class="record-row ${selected === f.path ? 'selected' : ''}" data-record="${escape(f.path)}"><span class="record-main"><span class="record-id">${escape(f.path.split('/').slice(0, -1).join('/'))}</span><span class="record-title">${escape(f.path.split('/').pop())}</span></span><span class="hint">${Math.ceil(f.size / 1024)} KB</span></button>`).join('') : rows.map(row => `<button class="record-row ${selected === row.meta.id ? 'selected' : ''}" data-record="${escape(row.meta.id)}"><span class="record-main"><span class="record-id">${escape(row.meta.id)}</span><span class="record-title">${escape(row.meta.title)}</span>${row.meta.depends_on?.length ? `<small>After ${row.meta.depends_on.map(escape).join(', ')}</small>` : ''}</span>${pill(row.ready ? 'ready' : row.meta.status)}</button>`).join('');
  $('content').innerHTML = `<div class="split"><div class="panel"><div class="panel-heading"><h2>${titles[tab]}</h2>${filterControl}</div><div class="list">${list || empty(docs ? `No ${tab === 'docs' ? 'documents' : 'artifacts'} in this snapshot yet.` : 'No records match this view.')}</div></div><aside class="panel detail" id="detail" aria-label="Selected record">${empty('Select a record to inspect its files and context.')}</aside></div>`;
  if (selected) {
    if (docs) renderDocument(files.find(f => f.path === selected)!);
    else renderRecord(rows.find(r => r.meta.id === selected)!);
  }
}
function renderDocument(file: DocumentFile) {
  $('detail').innerHTML = `<div class="detail-head"><span class="eyebrow">${tab === 'docs' ? 'DOCUMENTATION' : 'ARTIFACT'}</span><span class="hint">${file.size} bytes</span></div><h2>${escape(file.path.split('/').pop())}</h2>${file.text === null ? '<p class="hint">Binary artifact. Open the repository file with an appropriate viewer.</p>' : file.path.endsWith('.md') ? `<div class="markdown">${markdown(file.text)}</div>` : `<div class="markdown"><pre>${escape(file.text)}</pre></div>`}<span class="detail-path mono">${escape(file.path)}<br>SHA-256 ${file.revision.slice(0, 16)}</span>`;
}
function renderRecord(row: RecordFile) {
  const { meta } = row;
  const linkIds = (values: string[], kind = 'tasks') => values.map(id => `<button data-jump="${escape(id)}" data-kind="${kind}">${escape(id)}</button>`).join('') || 'None';
  const info = [
    ...(meta.kind === 'task' ? [['Depends on', linkIds(meta.depends_on || [])], ['Decisions', linkIds(meta.decisions || [], 'decisions')], ['Assignee', escape(meta.assignee || 'Not assigned')]] : []),
    ...(meta.supersedes ? [['Supersedes', linkIds([meta.supersedes], 'decisions')]] : []),
    ...(meta.paths?.length ? [['Code / paths', meta.paths.map(path => `<span class="mono">${escape(path)}</span>`).join('<br>')]] : []),
    ...(meta.artifacts?.length ? [['Artifacts', meta.artifacts.map(path => `<span class="mono">${escape(path)}</span>`).join('<br>')]] : []),
  ];
  $('detail').innerHTML = `<div class="detail-head"><span class="eyebrow">${escape(meta.kind.toUpperCase())} / ${escape(meta.id)}</span>${pill(meta.status)}</div><h2>${escape(meta.title)}</h2>${info.length ? `<dl class="record-meta">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}<div class="markdown">${markdown(row.body)}</div>${meta.kind === 'task' ? '<section id="commits" class="commits"><h3>Linked commits</h3><p class="hint">Reading Git trailers…</p></section>' : ''}<span class="detail-path mono">${escape(row.path)}<br>SHA-256 ${row.revision.slice(0, 16)}</span>`;
  if (meta.kind === 'task') void loadCommits(meta.id);
}
async function loadCommits(id: string) {
  const ticket = ++detailSerial;
  try {
    const result = await api<{ commits: { hash: string; subject: string }[]; scanned: number; truncated: boolean }>(projectUrl(`commits?${contextQuery()}&task=${encodeURIComponent(id)}`));
    if (ticket !== detailSerial || !$('commits')) return;
    $('commits').innerHTML = `<h3>Linked commits</h3>${result.commits.map(c => `<div class="commit"><code title="${escape(c.hash)}">${c.hash.slice(0, 8)}</code><span>${escape(c.subject)}</span></div>`).join('') || '<p class="hint">No matching Task trailers in the scanned history.</p>'}<p class="hint">${result.scanned} commits scanned${result.truncated ? ' · Older history is not included' : ''}</p>`;
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
type Activity = Worktree & { dirty?: boolean; errors: string[]; tasks: { id: string; title: string; status: string; assignee?: string; pendingIntegration: boolean }[] };
async function renderWorktrees() {
  const currentProject = projectId;
  const result = await api<{ activity: Activity[]; acceptedAvailable: boolean }>(projectUrl('activity'));
  if (tab !== 'worktrees' || currentProject !== projectId) return;
  const counts = new Map<string, number>();
  for (const tree of result.activity) for (const task of tree.tasks.filter(t => t.status === 'in_progress')) counts.set(task.id, (counts.get(task.id) || 0) + 1);
  const overlaps = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  $('content').innerHTML = `${!result.acceptedAvailable ? '<div class="notice">Accepted branch unavailable; completions cannot yet be compared with the integrated plan.</div>' : ''}${overlaps.length ? `<div class="notice">In-progress records appear in multiple worktrees: ${overlaps.map(escape).join(', ')}. This may be inherited state; it is not proof of active agents or an exclusive claim.</div>` : ''}<div class="tree-grid">${result.activity.map(tree => `<article class="panel tree-card"><div class="detail-head"><span class="eyebrow">${tree.branch ? 'BRANCH' : 'DETACHED CHECKOUT'}</span>${tree.dirty ? pill('uncommitted') : pill('clean')}</div><h2>${escape(tree.branch || tree.head?.slice(0, 8) || 'Unborn')}</h2><p class="path mono">${escape(tree.root)}</p>${tree.locked ? '<p class="hint">Git worktree is locked against pruning.</p>' : ''}${tree.tasks.map(task => `<div class="tree-task"><span><span class="mono">${escape(task.id)}</span><br>${escape(task.title)}${task.assignee ? `<br><span class="hint">${escape(task.assignee)}</span>` : ''}</span>${pill(task.pendingIntegration ? 'awaiting_integration' : task.status)}</div>`).join('') || '<p class="hint">No in-progress, blocked or unintegrated completions recorded.</p>'}${tree.errors.length ? `<p class="error">${tree.errors.map(escape).join('<br>')}</p>` : ''}<button data-worktree="${tree.id}" ${!tree.available ? 'disabled' : ''}>Inspect checkout files →</button></article>`).join('')}</div><p class="view-note">These are file states, not live agent activity. Worktrees share Git history; integrating changes remains an ordinary Git operation.</p>`;
}

function openRegistration() { $('register-error').hidden = true; $<HTMLDialogElement>('register-dialog').showModal(); $<HTMLInputElement>('register-path').focus(); }
$('register-open').onclick = openRegistration; $('empty-register').onclick = openRegistration;
$('register-close').onclick = () => $<HTMLDialogElement>('register-dialog').close();
$('register-form').onsubmit = async event => {
  event.preventDefault(); const button = document.querySelector<HTMLButtonElement>('#register-form button[type="submit"]')!; button.disabled = true;
  try {
    const result = await api<{ project: Registration }>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-command-write': '1' }, body: JSON.stringify({ path: $<HTMLInputElement>('register-path').value.trim() }) });
    projectId = result.project.id; checkoutId = ''; selected = ''; state = null;
    $<HTMLDialogElement>('register-dialog').close(); await loadProjects();
  } catch (error) { $('register-error').textContent = error instanceof Error ? error.message : String(error); $('register-error').hidden = false; }
  finally { button.disabled = false; }
};
$('project').onchange = async () => { projectId = $<HTMLSelectElement>('project').value; checkoutId = ''; state = null; selected = ''; localStorage.setItem('command.project', projectId); await refresh(true); };
$('checkout').onchange = () => { checkoutId = $<HTMLSelectElement>('checkout').value; void refresh(true); };
$('source').onchange = () => { source = $<HTMLSelectElement>('source').value as typeof source; void refresh(true); };
$('refresh').onclick = () => { void refresh(true); };
$('unregister').onclick = async () => {
  if (!confirm('Remove this local registration? Repository files and Git history will not be changed.')) return;
  try { await api(`/api/projects/${projectId}`, { method: 'DELETE', headers: { 'x-command-write': '1' } }); projectId = ''; state = null; await loadProjects(); } catch (error) { showError(error); }
};
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.onclick = () => { tab = button.dataset.tab!; selected = ''; renderContent(); });
$('content').addEventListener('change', event => { if ((event.target as HTMLElement).id === 'task-filter') { filter = (event.target as HTMLSelectElement).value; renderContent(); } });
$('content').addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('[data-record],[data-jump],[data-graph],[data-worktree]'); if (!target) return;
  if (target.dataset.worktree) { checkoutId = target.dataset.worktree; source = 'checkout'; $<HTMLSelectElement>('source').value = source; tab = 'tasks'; selected = ''; void refresh(true); return; }
  if (target.dataset.graph || target.dataset.jump) { selected = target.dataset.graph || target.dataset.jump!; tab = target.dataset.kind || 'tasks'; filter = 'all'; }
  else selected = target.dataset.record!;
  renderContent();
});
$('content').addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && (event.target as HTMLElement).matches('[data-graph]')) { event.preventDefault(); (event.target as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
void loadProjects().catch(showError);
setInterval(() => { if (!document.hidden && !refreshing && !$<HTMLDialogElement>('register-dialog').open) void refresh(); }, 4000);
