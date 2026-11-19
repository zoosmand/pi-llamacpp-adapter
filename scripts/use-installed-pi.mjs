import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mkdir, lstat, symlink } from 'node:fs/promises';
const root = resolve(import.meta.dirname, '..');
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const agentRoot = resolve(globalRoot, '@earendil-works/pi-coding-agent');
const require = createRequire(resolve(agentRoot, 'package.json'));
for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', '@earendil-works/pi-schema']) {
  const target = name.endsWith('/pi-coding-agent') ? agentRoot
    : require.resolve.paths(name).map(base => resolve(base, name)).find(path => existsSync(resolve(path, 'package.json')));
  if (!target) throw new Error(`Installed Pi dependency missing: ${name}`);
  const destination = resolve(root, 'node_modules', name);
  await mkdir(dirname(destination), { recursive: true });
  try { await lstat(destination); console.log(`Already present: ${name}`); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(target, destination, 'dir'); console.log(`Linked ${name}`);
  }
}
