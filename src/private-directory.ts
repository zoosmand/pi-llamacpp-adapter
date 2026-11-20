import { lstat, mkdir, realpath } from 'node:fs/promises';

/** Create one private directory, or reject an existing entry we cannot safely own/reuse. */
export async function ensurePrivateDirectory(directory: string): Promise<string> {
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Temporary path is not a real directory: ${directory}`);
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(`Temporary directory is owned by another user: ${directory}`);
  }
  if ((info.mode & 0o077) !== 0) throw new Error(`Temporary directory must have private permissions (0700): ${directory}`);
  return realpath(directory);
}
