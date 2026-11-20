import assert from 'node:assert/strict';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ExtensionAPI, ProviderConfig } from '@earendil-works/pi-coding-agent';
import extension from '../src/extension.ts';
const command = 'printf \'%s\' "$PI_SESSION_TMPDIR"';
export default function proof(pi: ExtensionAPI) {
  pi.on('tool_call', event => {
    if (event.toolName === 'bash' && event.input.command === command) return;
    if (event.toolName === 'write' && typeof event.input.path === 'string' && process.env.PI_SESSION_TMPDIR) {
      const path = relative(process.env.PI_SESSION_TMPDIR, resolve(event.input.path));
      if (path && path !== '..' && !path.startsWith('../') && !isAbsolute(path) && event.input.content === process.env.PI_TEMP_PROOF_TEXT) return;
    }
    return { block: true, reason: 'Session-temp proof permits only printing PI_SESSION_TMPDIR or writing its exact draft inside that directory.' };
  });
  if (process.env.PI_TEMP_PROOF_LIVE === '1') { extension(pi); return; }
  const fetchFixture: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const directory = process.env.PI_SESSION_TMPDIR!;
    assert.ok(isAbsolute(directory));
    assert.ok(JSON.stringify(body.messages.filter((message: any) => ['system', 'developer'].includes(message.role))).includes(directory), 'actual session path must reach the model instructions');
    let text: string;
    if (body.messages.at(-1).role === 'tool') text = 'Done.';
    else {
      const user = body.messages.findLast((message: any) => message.role === 'user');
      const reporting = JSON.stringify(user.content).includes('Report your temp path');
      text = JSON.stringify(reporting ? { name: 'bash', arguments: { command } }
        : { name: 'write', arguments: { path: resolve(directory, 'comment.md'), content: process.env.PI_TEMP_PROOF_TEXT } });
      text = `<tool_call>${text}</tool_call>`;
    }
    return new Response(`data: ${JSON.stringify({ id: 'temp-fixture', choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  extension({ on: pi.on.bind(pi), registerCommand: pi.registerCommand.bind(pi), registerProvider(name: string, config: ProviderConfig) {
    pi.registerProvider(name, { ...config, streamSimple: (model, context, options) => config.streamSimple!(model, context, { ...options, fetch: fetchFixture }) });
  } } as ExtensionAPI);
}
