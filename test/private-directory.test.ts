import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePrivateDirectory } from '../src/private-directory.ts';
import { createSessionTemp } from '../src/session-temp.ts';

test('refuses a pre-existing permissive temp root without changing its permissions or contents', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-private-unit-')));
  try {
    const shared = join(root, 'shared');
    await mkdir(shared); await chmod(shared, 0o777);
    await assert.rejects(createSessionTemp('one', shared), /private permissions/);
    assert.equal((await stat(shared)).mode & 0o777, 0o777);
    assert.deepEqual(await readdir(shared), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('refuses symlink roots and pre-existing symlink session directories', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-private-unit-')));
  try {
    const target = await ensurePrivateDirectory(join(root, 'target'));
    const link = join(root, 'linked-root'); await symlink(target, link);
    await assert.rejects(createSessionTemp('one', link), /not a real directory/);
    const sessions = await ensurePrivateDirectory(join(root, 'sessions'));
    await symlink(target, join(sessions, 'session-one'));
    await assert.rejects(createSessionTemp('one', sessions), /not a real directory/);
    assert.deepEqual(await readdir(target), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('refuses a temp root owned by a different uid before creating session files', async context => {
  if (typeof process.getuid !== 'function') { context.skip('POSIX uid check'); return; }
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-private-unit-')));
  const uid = process.getuid();
  context.mock.method(process as { getuid(): number }, 'getuid', () => uid + 1);
  try {
    await assert.rejects(createSessionTemp('one', root), /owned by another user/);
    assert.deepEqual(await readdir(root), []);
  } finally { context.mock.restoreAll(); await rm(root, { recursive: true, force: true }); }
});
