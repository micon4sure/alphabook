import { fileURLToPath } from 'node:url';
import { Registry, message, snapshot, taskCommits, worktrees } from '../packages/core/index';

const webRoot = fileURLToPath(new URL('./web/', import.meta.url));
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json' } });

export async function createServer(options: { port?: number; home?: string } = {}) {
  const registry = new Registry(options.home);
  const build = await Bun.build({ entrypoints: [webRoot + 'app.ts'], target: 'browser', minify: true });
  if (!build.success) throw new Error(build.logs.join('\n'));
  const js = await build.outputs[0].text();
  const assets = new Map([
    ['/', { body: await Bun.file(webRoot + 'index.html').text(), type: 'text/html; charset=utf-8' }],
    ['/app.js', { body: js, type: 'text/javascript; charset=utf-8' }],
    ['/style.css', { body: await Bun.file(webRoot + 'style.css').text(), type: 'text/css; charset=utf-8' }],
  ]);
  const server = Bun.serve({
    hostname: '127.0.0.1', port: options.port ?? Number(process.env.COMMAND_PORT || 4320), maxRequestBodySize: 16_384,
    async fetch(request) {
      const url = new URL(request.url);
      const hosts = [`127.0.0.1:${server.port}`, `localhost:${server.port}`];
      const origins = hosts.map(host => `http://${host}`);
      if (!hosts.includes(request.headers.get('host') || '') || request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.has('origin') && !origins.includes(request.headers.get('origin')!)) return json({ error: 'Local same-origin access only' }, 403);
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('x-command-write') !== '1') return json({ error: 'Missing explicit local write header' }, 403);
      try {
        if (url.pathname === '/api/projects') {
          if (request.method === 'GET') return json({ projects: registry.list() });
          if (request.method === 'POST') {
            const body = await request.json();
            if (typeof body.path !== 'string') return json({ error: 'path must be a string' }, 400);
            return json({ project: registry.register(body.path) }, 201);
          }
        }
        const match = /^\/api\/projects\/([a-f0-9]{20})(?:\/(worktrees|snapshot|commits|activity))?$/.exec(url.pathname);
        if (match) {
          const project = registry.get(match[1]);
          if (!match[2] && request.method === 'DELETE') { registry.unregister(project.id); return json({ removed: true }); }
          if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
          if (match[2] === 'worktrees') return json({ worktrees: worktrees(project) });
          if (match[2] === 'activity') {
            const trees = worktrees(project);
            let accepted: ReturnType<typeof snapshot> | null = null;
            try { accepted = snapshot(project, trees.find(t => t.available)!.id, 'accepted'); } catch { /* Missing branch is shown separately. */ }
            const activity = trees.map(tree => {
              try {
                const state = snapshot(project, tree.id);
                return { ...tree, dirty: state.context.dirty, errors: state.errors, tasks: state.tasks.filter(t => t.meta.status === 'in_progress' || t.meta.status === 'blocked' || t.meta.status === 'done' && accepted?.tasks.find(a => a.meta.id === t.meta.id)?.meta.status !== 'done').map(t => ({ id: t.meta.id, title: t.meta.title, status: t.meta.status, assignee: t.meta.assignee, pendingIntegration: t.meta.status === 'done' })) };
              } catch (error) { return { ...tree, tasks: [], errors: [message(error)] }; }
            });
            return json({ activity, acceptedAvailable: Boolean(accepted) });
          }
          const checkout = url.searchParams.get('checkout');
          const source = url.searchParams.get('source') || 'checkout';
          if (!checkout || !['checkout', 'accepted'].includes(source)) return json({ error: 'Explicit checkout and valid source are required' }, 400);
          if (match[2] === 'snapshot') return json(snapshot(project, checkout, source as 'checkout' | 'accepted'));
          if (match[2] === 'commits') {
            const task = url.searchParams.get('task');
            if (!task) return json({ error: 'task is required' }, 400);
            return json(taskCommits(project, checkout, task, source as 'checkout' | 'accepted'));
          }
        }
        if (request.method === 'GET' || request.method === 'HEAD') {
          const asset = assets.get(url.pathname);
          if (asset) return new Response(request.method === 'HEAD' ? null : asset.body, { headers: { ...securityHeaders, 'Content-Type': asset.type } });
          if (url.pathname === '/DINish-Regular.ttf') return new Response(request.method === 'HEAD' ? null : Bun.file(webRoot + 'fonts/DINish-Regular.ttf'), { headers: { ...securityHeaders, 'Content-Type': 'font/ttf' } });
        }
        return json({ error: 'Not found' }, 404);
      } catch (error) { return json({ error: message(error) }, 400); }
    },
  });
  return server;
}

if (import.meta.main) {
  const server = await createServer();
  console.log(`Command Center: http://127.0.0.1:${server.port}`);
  console.log('Local file-first planning viewer. MCP queries run separately with bun run mcp.');
}
