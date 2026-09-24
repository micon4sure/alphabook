import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { fixture, task } from './fixture';
import { git, snapshot } from '../packages/core/index';

let f: ReturnType<typeof fixture>, child: ChildProcess, base = '';
test.beforeAll(async () => {
  f = fixture(); f.registry.unregister(f.project.id);
  child = spawn('bun', ['apps/server.ts'], { cwd: process.cwd(), env: { ...process.env, ALPHABOOK_HOME: f.registry.home, ALPHABOOK_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser test server did not start')), 10_000);
    child.stdout!.on('data', chunk => { const found = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk)); if (found) { clearTimeout(timeout); resolve(found[0]); } });
    child.once('error', reject); child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Browser server exited: ${code}`)); });
    child.stderr!.on('data', chunk => process.stderr.write(chunk));
  });
});
test.afterAll(async () => { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } f?.cleanup(); });

test('shared dashboard, four worktrees, file-only updates and safe UI CRUD', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await expect(page).toHaveTitle('Alphabook');
  await expect(page.getByRole('link', { name: 'Alphabook home' })).toBeVisible();
  await expect(page.locator('footer')).toContainText('ALPHABOOK BY TECHTILE');
  const credit = page.getByRole('link', { name: 'TECHTILE', exact: true });
  await expect(credit).toHaveAttribute('href', 'https://techtile.media');
  await expect(credit).toHaveAttribute('target', '_blank');
  await expect(credit).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('button', { name: 'Register your first project' }).click();
  await page.getByLabel('Absolute project directory').fill(f.root);
  await page.getByRole('button', { name: 'Register project', exact: true }).click();
  await expect(page.locator('#project-name')).toHaveText('Test project');
  await expect(page.locator('#checkout, #source')).toHaveCount(0);
  await expect(page.locator('#commits')).toContainText('Initial plan');
  const changes = new Map<string, string>();
  for (let i = 1; i <= 4; i++) {
    git(f.root, ['worktree', 'add', '-b', `task/T-00${i}`, join(f.dir, `worker-${i}`)]);
    changes.set(`tasks/T-00${i}.md`, task(`T-00${i}`, 'in_progress', `branches: [task/T-00${i}]\nassignee: agent-${i}\n`));
  }
  f.rawPlan(changes);
  await expect(page.locator('.activity-card')).toHaveCount(4, { timeout: 10_000 });
  await expect(page.locator('.record-row')).toHaveCount(4);
  await expect(page.locator('#context')).toContainText('5 code worktrees');
  await page.getByRole('button', { name: 'Task graph', exact: true }).click();
  await page.getByRole('button', { name: 'Open T-002: Task T-002' }).press('Enter');
  await expect(page.locator('#detail h2')).toHaveText('Task T-002');
  await expect(page.locator('#detail')).toContainText('task/T-002');
  await page.getByRole('button', { name: 'Decisions', exact: true }).click();
  await expect(page.locator('#detail')).toContainText('Decision body.');
  await page.getByRole('button', { name: 'Artifacts', exact: true }).click();
  await expect(page.locator('#detail')).toContainText('Passed.');
  await page.getByRole('button', { name: 'Worktrees', exact: true }).click();
  await expect(page.locator('.tree-card')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Inspect checkout files' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Documentation', exact: true }).click();
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByLabel('Repository-relative planning path').fill('docs/ui.md');
  await page.getByLabel('File content').fill('# Browser document\n\nCreated in the UI.');
  await page.getByLabel('Commit message').fill('Add browser document');
  await page.getByRole('button', { name: 'Save & commit', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('.record-row').filter({ hasText: 'ui.md' }).click();
  await expect(page.locator('#detail')).toContainText('Created in the UI.');
  await page.locator('#edit-file').click();
  await page.getByLabel('File content').fill('# Updated in UI');
  f.write('docs/guide.md', '# Concurrent change');
  await page.getByRole('button', { name: 'Save & commit', exact: true }).click();
  await expect(page.locator('#editor-error')).toContainText('Conflict');
  expect(snapshot(f.project).documents.find(d => d.path.endsWith('ui.md'))?.text).toContain('Created in the UI');
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh project', exact: true }).click();
  await expect(page.locator('#context')).toContainText(snapshot(f.project).context.head.slice(0, 8));
  await page.locator('#edit-file').click();
  await page.getByLabel('File content').fill('# Updated in UI');
  await page.getByRole('button', { name: 'Save & commit', exact: true }).click();
  await expect(page.locator('#detail')).toContainText('Updated in UI');
  await page.locator('#edit-file').click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete file…', exact: true }).click();
  await expect(page.locator('.record-row').filter({ hasText: 'ui.md' })).toHaveCount(0);

  f.write('docs/guide.md', '# External Git edit\n\n<script>window.__xss = 1</script>\n<img src=x onerror="window.__xss = 2">\n');
  await expect(page.locator('#detail')).toContainText('External Git edit', { timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('#detail img, #detail script')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tasks 4', exact: true }).click();
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
