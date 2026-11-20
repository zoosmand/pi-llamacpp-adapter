import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/** Observe Pi's trust decision; never grant trust or consult a parallel trust store. */
export function registerTrustGate(pi: ExtensionAPI): () => boolean {
  let trusted = () => false;
  const observe = (_event: unknown, ctx: ExtensionContext) => { trusted = () => ctx.isProjectTrusted(); };
  pi.on('session_start', observe);
  pi.on('before_agent_start', observe);
  pi.on('tool_call', (event, ctx) => {
    if (event.toolCallId.startsWith('adapter_') && !ctx.isProjectTrusted()) {
      return { block: true, reason: 'The llamacpp adapter requires a trusted project before executing recovered tool calls.' };
    }
  });
  return () => trusted();
}
