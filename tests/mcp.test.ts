import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, resolve } from 'node:path';
import { fixture, task } from './fixture';
import { git, worktrees } from '../packages/core/index';

const f = fixture();
const client = new Client({ name: 'command-test-client', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('apps/mcp.ts')], env: { ...process.env, COMMAND_HOME: f.registry.home } as Record<string, string>, stderr: 'pipe' });
const context = { projectId: f.project.id, checkoutId: worktrees(f.project)[0].id, source: 'checkout' };
beforeAll(async () => { await client.connect(transport); });
afterAll(async () => { await client.close(); f.cleanup(); });
async function call(name: string, args: Record<string, unknown> = {}) {
  return await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Record<string, any>; content: { type: string; text?: string }[] };
}
test('real stdio handshake advertises only read-only planning tools', async () => {
  const result = await client.listTools();
  expect(result.tools).toHaveLength(11);
  expect(result.tools.every(t => t.annotations?.readOnlyHint && t.annotations?.destructiveHint === false)).toBe(true);
  expect(result.tools.some(t => /write|commit_planning|run_agent/.test(t.name))).toBe(false);
  expect((await call('list_projects')).structuredContent?.projects[0].id).toBe(f.project.id);
  expect((await call('list_worktrees', { projectId: f.project.id })).structuredContent?.worktrees[0].id).toBe(context.checkoutId);
  expect((await client.readResource({ uri: 'command://projects' })).contents[0].mimeType).toBe('application/json');
});
test('queries open and ready tasks, full records, docs and commit links', async () => {
  expect((await call('list_tasks', context)).structuredContent?.tasks).toHaveLength(2);
  expect((await call('list_tasks', { ...context, filter: 'ready' })).structuredContent?.tasks.map((t: any) => t.meta.id)).toEqual(['T-001']);
  expect((await call('read_task', { ...context, taskId: 'T-001' })).structuredContent?.task.body).toContain('Task description');
  expect((await call('list_decisions', context)).structuredContent?.decisions).toHaveLength(1);
  expect((await call('read_decision', { ...context, decisionId: 'D-001' })).structuredContent?.decision.body).toContain('Decision body');
  expect((await call('list_documents', context)).structuredContent?.documents[0].path).toBe('.command/docs/guide.md');
  expect((await call('read_document', { ...context, path: '.command/docs/guide.md' })).structuredContent?.document.text).toContain('Ordinary files');
  expect((await call('list_task_commits', { ...context, taskId: 'T-001' })).structuredContent?.commits).toHaveLength(1);
  expect((await call('validate_project', context)).structuredContent?.valid).toBe(true);
  expect((await call('read_project', context)).structuredContent?.counts.tasks).toBe(2);
});
test('file-only changes refresh immediately without a web server or MCP writes', async () => {
  f.put('.command/tasks/T-001.md', task('T-001', 'done'));
  expect((await call('list_tasks', context)).structuredContent?.tasks.map((t: any) => t.meta.id)).toEqual(['T-002']);
  expect((await call('list_tasks', { ...context, source: 'accepted' })).structuredContent?.tasks).toHaveLength(2);
  expect((await call('list_tasks', { ...context, filter: 'ready' })).structuredContent?.tasks.map((t: any) => t.meta.id)).toEqual(['T-002']);
});
test('explicit worktree context is honored; arbitrary paths and IDs are rejected', async () => {
  const linked = join(f.dir, 'linked'); git(f.root, ['worktree', 'add', '-b', 'feature', linked]);
  const id = worktrees(f.project).find(w => w.root === linked)!.id;
  expect((await call('read_task', { ...context, checkoutId: id, taskId: 'T-001' })).structuredContent?.task.meta.status).toBe('planned');
  for (const args of [{ ...context, checkoutId: 'wrong' }, { ...context, projectId: 'wrong' }, { projectId: f.project.id }, { ...context, source: 'wrong' }]) expect((await call('read_project', args)).isError).toBe(true);
  expect((await call('read_document', { ...context, path: '/etc/passwd' })).isError).toBe(true);
  expect((await call('read_document', { ...context, path: '../outside' })).isError).toBe(true);
  expect((await call('read_task', { ...context, taskId: 'does-not-exist' })).isError).toBe(true);
  expect((await call('list_task_commits', { ...context, taskId: 'T-001', limit: 99999 })).isError).toBe(true);
});
test('validation diagnostics reach clients instead of silently claiming readiness', async () => {
  f.put('.command/tasks/T-002.md', task('T-002', 'planned', 'depends_on: [missing]\n'));
  const result = await call('validate_project', context);
  expect(result.structuredContent?.valid).toBe(false);
  expect(result.structuredContent?.errors.join(' ')).toContain('missing');
  expect((await call('list_tasks', { ...context, filter: 'ready' })).structuredContent?.tasks).toHaveLength(0);
});
