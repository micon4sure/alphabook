import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createServer } from '../apps/server';
import { fixture } from './fixture';
import { snapshot } from '../packages/core/index';
const f = fixture();
let server: Awaited<ReturnType<typeof createServer>>, base: string;
beforeAll(async () => { server = await createServer({ port: 0, home: f.registry.home }); base = `http://127.0.0.1:${server.port}`; });
afterAll(() => { server?.stop(true); f.cleanup(); });
test('server port configuration uses ALPHABOOK_PORT, not the old name', async () => {
  const saved = { ALPHABOOK_PORT: process.env.ALPHABOOK_PORT, COMMAND_PORT: process.env.COMMAND_PORT };
  let temporary: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    process.env.ALPHABOOK_PORT = '0';
    process.env.COMMAND_PORT = 'invalid-legacy-value';
    temporary = await createServer({ home: f.registry.home });
    expect(temporary.port).toBeGreaterThan(0);
  } finally {
    temporary?.stop(true);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test('bundled UI, security headers and no worktree/view switches', async () => {
  const response = await fetch(base), text = await response.text();
  expect(response.status).toBe(200); expect(text).toContain('SHARED PLAN');
  expect(text).toContain('<title>Alphabook</title>');
  expect(text).toContain('Alphabook home'); expect(text).not.toContain('COMMAND');
  expect(text).not.toContain('id="checkout"'); expect(text).not.toContain('id="source"');
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect((await fetch(base + '/app.js')).status).toBe(200);
  expect((await fetch(base + '/DINish-Regular.ttf')).status).toBe(200);
});
test('one project overview, shared snapshot and code/planning commits', async () => {
  const prefix = `${base}/api/projects/${f.project.id}`;
  expect((await (await fetch(base + '/api/projects')).json()).projects[0].id).toBe(f.project.id);
  expect((await (await fetch(prefix + '/overview')).json()).worktrees).toHaveLength(1);
  expect((await (await fetch(prefix + '/snapshot')).json()).tasks).toHaveLength(2);
  expect((await (await fetch(prefix + '/commits?task=T-001')).json()).commits[0].kind).toBe('planning');
});
test('cross-origin reads, rebinding hosts and ambient writes are blocked', async () => {
  const cases: Record<string, string>[] = [{ Origin: 'https://evil.example' }, { Host: 'evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }];
  for (const headers of cases) expect((await fetch(base + '/api/projects', { headers })).status).toBe(403);
  expect((await fetch(base + '/api/projects', { method: 'POST', body: JSON.stringify({ path: f.root }) })).status).toBe(403);
  expect((await fetch(base + '/api/projects', { method: 'POST', headers: { 'x-command-write': '1' }, body: JSON.stringify({ path: f.root }) })).status).toBe(403);
  expect((await fetch(base + '/api/projects', { method: 'POST', headers: { 'x-alphabook-write': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ path: f.root }) })).status).toBe(201);
});
test('UI mutations use validated Git transactions and explicit revisions', async () => {
  const state = snapshot(f.project), row = state.tasks[0];
  const request = { path: row.path, content: row.content.replace('planned', 'done'), expectedHead: state.context.head, expectedRevision: row.revision, message: 'Complete task' };
  const prefix = `${base}/api/projects/${f.project.id}/planning`;
  expect((await fetch(prefix, { method: 'POST', body: JSON.stringify(request) })).status).toBe(403);
  const post = () => fetch(prefix, { method: 'POST', headers: { 'x-alphabook-write': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  expect((await (await post()).json()).committed).toBe(true);
  expect((await post()).status).toBe(400);
  expect(snapshot(f.project).tasks[0].meta.status).toBe('done');
});
test('arbitrary files and source are never served', async () => {
  for (const path of ['/package.json', '/project.yaml', '/api/file?path=/etc/passwd', '/apps/server.ts']) expect((await fetch(base + path)).status).toBe(404);
});
