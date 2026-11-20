import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

export const sessionTempRoot = () => join(tmpdir(), 'pi-llamacpp-adapter', 'sessions');

/** Stable per session, safe even for externally supplied session identifiers. */
export async function createSessionTemp(sessionId: string, root = sessionTempRoot()): Promise<string> {
  const key = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)
    ? `session-${sessionId}` : `hash-${createHash('sha256').update(sessionId).digest('hex')}`;
  const directory = join(root, key);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return realpath(directory);
}

export function sessionTempInstructions(directory: string): string {
  return `Session temporary directory: ${JSON.stringify(directory)}
Use this directory for temporary comment drafts, request bodies, helper scripts, scratch output, and other temporary artifacts. It is outside the repository. Do not save temporary files in the repository or change the working directory for ordinary repository commands.
The bash tool can address it as "$PI_SESSION_TMPDIR". For a unique temporary file use mktemp "$PI_SESSION_TMPDIR/comment.XXXXXX"; use the returned real filename in subsequent tools. For write/read tools use the absolute directory shown above plus a descriptive filename. Do not use the literal variable name in a write-tool path because that tool does not expand shell variables.
Honor a destination explicitly requested by the user. These rules apply to temporary artifacts; source files requested as part of the application belong in their intended project paths.
The directory is retained after Pi exits so the user can inspect it. Report full paths for created artifacts. The user can run /session-temp to see this session's directory.`;
}

export function registerSessionTemp(pi: ExtensionAPI, root = sessionTempRoot()): void {
  let active: string | undefined;
  const previous = process.env.PI_SESSION_TMPDIR;
  const announced = new Set<string>();
  async function activate(ctx: ExtensionContext): Promise<string> {
    const directory = await createSessionTemp(ctx.sessionManager.getSessionId(), root);
    active = directory;
    process.env.PI_SESSION_TMPDIR = directory;
    return directory;
  }
  pi.on('session_start', async (_event, ctx) => {
    const directory = await activate(ctx);
    if (ctx.hasUI && !announced.has(directory)) {
      ctx.ui.notify(`Session temporary directory: ${directory}`, 'info');
      announced.add(directory);
    }
  });
  pi.on('before_agent_start', async (event, ctx) => {
    const directory = await activate(ctx);
    if (ctx.model?.provider !== 'llamacpp-adapter') return;
    const instructions = sessionTempInstructions(directory);
    event.systemPromptOptions.sections.pi_session_temp = instructions;
    if (event.systemPromptOptions.forceSystemPrompt !== undefined) {
      return { systemPrompt: `${event.systemPrompt}\n\n${instructions}` };
    }
  });
  pi.on('session_shutdown', () => {
    if (active && process.env.PI_SESSION_TMPDIR === active) {
      if (previous === undefined) delete process.env.PI_SESSION_TMPDIR;
      else process.env.PI_SESSION_TMPDIR = previous;
    }
    // Deliberately retain files: the user may refer to them after exit or resume.
  });
  pi.registerCommand('session-temp', {
    description: 'Show the current Pi session temporary directory',
    handler: async (_args, ctx) => { ctx.ui.notify(await activate(ctx), 'info'); },
  });
}
