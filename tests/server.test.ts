import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createServer } from '../apps/server';
import { fixture } from './fixture';
import { worktrees } from '../packages/core/index';

const f = fixture();
let server: Awaited<ReturnType<typeof createServer>>, base: string;
beforeAll(async () => { server = await createServer({ port: 0, home: f.registry.home }); base = `http://127.0.0.1:${server.port}`; });
afterAll(() => { server?.stop(true); f.cleanup(); });
test('serves a bundled local UI with strict security headers', async () => {
  const result = await fetch(base);
  expect(result.status).toBe(200);
  expect(await result.text()).toContain('Register a project');
  expect(result.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect((await fetch(base + '/app.js')).status).toBe(200);
  expect((await fetch(base + '/DINish-Regular.ttf')).status).toBe(200);
});
test('registry, worktree, snapshot and commit APIs share the reader', async () => {
  const projects = await (await fetch(base + '/api/projects')).json();
  expect(projects.projects[0].id).toBe(f.project.id);
  const id = worktrees(f.project)[0].id;
  const prefix = `${base}/api/projects/${f.project.id}`;
  expect((await (await fetch(prefix + '/worktrees')).json()).worktrees[0].id).toBe(id);
  expect((await (await fetch(prefix + `/snapshot?checkout=${id}&source=accepted`)).json()).tasks).toHaveLength(2);
  expect((await (await fetch(prefix + `/commits?checkout=${id}&task=T-001`)).json()).commits).toHaveLength(1);
  expect((await (await fetch(prefix + '/activity')).json()).acceptedAvailable).toBe(true);
  expect((await fetch(prefix + '/snapshot')).status).toBe(400);
  expect((await fetch(prefix + '/snapshot?checkout=wrong')).status).toBe(400);
});
test('rejects cross-origin reads, DNS rebinding hosts and ambient writes', async () => {
  expect((await fetch(base + '/api/projects', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  expect((await fetch(base + '/api/projects', { headers: { Host: 'evil.example' } })).status).toBe(403);
  expect((await fetch(base + '/api/projects', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  expect((await fetch(base + '/api/projects', { method: 'POST', body: JSON.stringify({ path: f.root }) })).status).toBe(403);
  expect((await fetch(base + '/api/projects', { method: 'POST', headers: { 'x-command-write': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ path: f.root }) })).status).toBe(201);
});
test('does not expose source or arbitrary local files', async () => {
  for (const path of ['/package.json', '/.command/project.yaml', '/api/file?path=/etc/passwd', '/apps/server.ts']) expect((await fetch(base + path)).status).toBe(404);
});
