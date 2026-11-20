import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePrivateDirectory } from '../src/private-directory.ts';

/** Proof evidence belongs outside the repository and is retained for inspection. */
export async function createTestArtifacts(kind: string): Promise<string> {
  const root = await ensurePrivateDirectory(join(tmpdir(), 'pi-llamacpp-adapter-tests'));
  return mkdtemp(join(root, `${kind}-`));
}
