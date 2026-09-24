import { readFileSync } from 'node:fs';
import { Registry, message, snapshot } from '../packages/core/index';
import { overview } from '../packages/core/overview';
import { initializeProject, writePlanning } from '../packages/core/write';

export async function run(args: string[]) {
  const registry = new Registry();
  const [command, target, name, codeBranch] = args;
  switch (command) {
    case 'init':
      if (!target || !name) throw new Error('Usage: command init /absolute/repo "Project name" [code-branch]');
      return initializeProject(target, name, { codeBranch, home: registry.home });
    case 'register': return { project: registry.register(target) };
    case 'projects': return { projects: registry.list() };
    case 'show': return overview(registry.get(target));
    case 'validate': {
      const state = snapshot(registry.get(target));
      return { valid: !state.errors.length, errors: state.errors, head: state.context.head };
    }
    case 'write': {
      if (!target) throw new Error('Usage: command write request.json (or - for stdin). See agent primer for request fields.');
      const data = JSON.parse(target === '-' ? await Bun.stdin.text() : readFileSync(target, 'utf8'));
      if (typeof data.projectId !== 'string' || typeof data.path !== 'string' || !(data.content === null || typeof data.content === 'string') || typeof data.expectedHead !== 'string' || !(data.expectedRevision === null || typeof data.expectedRevision === 'string') || typeof data.message !== 'string' || data.taskIds !== undefined && (!Array.isArray(data.taskIds) || data.taskIds.some((id: unknown) => typeof id !== 'string'))) throw new Error('Invalid write request: projectId, path, content, expectedHead, expectedRevision and message are required');
      return writePlanning({ project: registry.get(data.projectId), path: data.path, content: data.content, expectedHead: data.expectedHead, expectedRevision: data.expectedRevision, message: data.message, taskIds: data.taskIds });
    }
    default: throw new Error('Usage: command init|register|projects|show|validate|write. MCP and the web server are optional.');
  }
}
if (import.meta.main) {
  try { console.log(JSON.stringify(await run(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(message(error)); process.exitCode = 1; }
}
