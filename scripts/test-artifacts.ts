import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Proof evidence belongs outside the repository and is retained for inspection. */
export async function createTestArtifacts(kind: string): Promise<string> {
  const root = join(tmpdir(), 'pi-llamacpp-adapter-tests');
  await mkdir(root, { recursive: true, mode: 0o700 });
  return mkdtemp(join(root, `${kind}-`));
}
