import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, resolve } from 'node:path';
import { fixture, task } from './fixture';
import { git, snapshot } from '../packages/core/index';
const f = fixture(), context = { projectId: f.project.id };
const client = new Client({ name: 'alphabook-test-client', version: '0.3.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('apps/mcp.ts')], env: { ...process.env, ALPHABOOK_HOME: f.registry.home } as Record<string, string>, stderr: 'pipe' });
beforeAll(async () => { await client.connect(transport); });
afterAll(async () => { await client.close(); f.cleanup(); });
async function call(name: string, args: Record<string, unknown> = {}) {
  return await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Record<string, any>; content: { type: string; text?: string }[] };
}
test('real stdio discovery distinguishes read-only tools from planning mutations', async () => {
  expect(client.getServerVersion()?.name).toBe('alphabook-planning');
  const result = await client.listTools();
  expect(result.tools).toHaveLength(17);
  expect(result.tools.filter(t => t.annotations?.readOnlyHint)).toHaveLength(11);
  expect(result.tools.find(t => t.name === 'delete_planning_file')?.annotations?.destructiveHint).toBe(true);
  expect((await call('list_projects')).structuredContent?.projects[0].id).toBe(f.project.id);
  expect((await call('register_project', { path: f.root })).structuredContent?.project.id).toBe(f.project.id);
  expect((await client.readResource({ uri: 'alphabook://projects' })).contents[0].mimeType).toBe('application/json');
  expect((await client.listResources()).resources.map(resource => resource.uri)).toEqual(['alphabook://projects']);
  await expect(client.readResource({ uri: 'command://projects' })).rejects.toThrow();
});
test('global plan queries need no checkout ID or running web server', async () => {
  expect((await call('list_tasks', context)).structuredContent?.tasks).toHaveLength(2);
  expect((await call('list_tasks', { ...context, filter: 'ready' })).structuredContent?.tasks.map((t: any) => t.meta.id)).toEqual(['T-001']);
  expect((await call('read_task', { ...context, taskId: 'T-001' })).structuredContent?.task.content).toContain('Task description');
  expect((await call('list_decisions', context)).structuredContent?.decisions).toHaveLength(1);
  expect((await call('read_decision', { ...context, decisionId: 'D-001' })).structuredContent?.decision.body).toContain('Decision body');
  expect((await call('read_document', { ...context, path: 'docs/guide.md' })).structuredContent?.document.text).toContain('Ordinary Git');
  expect((await call('list_documents', context)).structuredContent?.artifacts).toHaveLength(1);
  expect((await call('list_task_commits', { ...context, taskId: 'T-001' })).structuredContent?.commits).toHaveLength(1);
  expect((await call('validate_project', context)).structuredContent?.valid).toBe(true);
  expect((await call('read_project', context)).structuredContent?.worktrees).toHaveLength(1);
});
test('MCP task update is committed centrally and immediately visible across worktrees', async () => {
  git(f.root, ['worktree', 'add', '-b', 'task/T-001', join(f.dir, 'worker')]);
  const state = snapshot(f.project), row = state.tasks[0];
  const input = { ...context, id: 'T-001', content: task('T-001', 'in_progress', 'branches: [task/T-001]\n'), expectedHead: state.context.head, expectedRevision: row.revision, message: 'Start first task' };
  expect((await call('write_task', input)).structuredContent?.committed).toBe(true);
  expect((await call('write_task', input)).isError).toBe(true);
  const result = await call('list_worktrees', context);
  expect(result.structuredContent?.worktrees.find((w: any) => w.branch === 'task/T-001').tasks[0].meta.status).toBe('in_progress');
  expect(git(f.root, ['branch', '--show-current']).trim()).toBe('main');
});
test('MCP create, read, update and delete document use one shared Git writer', async () => {
  const path = 'docs/mcp.md';
  const create = await call('write_document', { ...context, path, content: '# First', expectedHead: snapshot(f.project).context.head, expectedRevision: null, message: 'Add guide' });
  expect(create.isError).not.toBe(true);
  const row = (await call('read_document', { ...context, path })).structuredContent!;
  expect(row.document.text).toBe('# First');
  expect((await call('write_document', { ...context, path, content: '# Updated', expectedHead: row.context.head, expectedRevision: row.document.revision, message: 'Update guide' })).structuredContent?.committed).toBe(true);
  const updated = (await call('read_document', { ...context, path })).structuredContent!;
  expect((await call('delete_planning_file', { ...context, path, expectedHead: updated.context.head, expectedRevision: updated.document.revision, message: 'Remove guide' })).structuredContent?.deleted).toBe(true);
  expect((await call('read_document', { ...context, path })).isError).toBe(true);
});
test('invalid IDs, arbitrary paths and broken references fail safely', async () => {
  expect((await call('read_project', { projectId: 'wrong' })).isError).toBe(true);
  expect((await call('read_document', { ...context, path: '/etc/passwd' })).isError).toBe(true);
  expect((await call('read_task', { ...context, taskId: 'missing' })).isError).toBe(true);
  const state = snapshot(f.project), row = state.tasks[0];
  expect((await call('write_task', { ...context, id: 'T-001', content: task('T-001', 'done', 'depends_on: [missing]\n'), expectedHead: state.context.head, expectedRevision: row.revision, message: 'Invalid plan' })).isError).toBe(true);
  expect(snapshot(f.project).context.head).toBe(state.context.head);
});
