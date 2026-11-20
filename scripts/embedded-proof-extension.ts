/** Deterministic model fixture; real Pi tools, no network or GitLab mutation. */
import assert from 'node:assert/strict';
import type { ExtensionAPI, ProviderConfig } from '@earendil-works/pi-coding-agent';
import extension from '../src/extension.ts';
export default function embeddedProof(pi: ExtensionAPI) {
  const path = process.env.PI_EMBEDDED_DRAFT!;
  const content = process.env.PI_EMBEDDED_BODY!;
  const command = process.env.PI_EMBEDDED_COMMAND!;
  const write = JSON.stringify({ name: 'write', arguments: { path, content } });
  const bash = JSON.stringify({ name: 'bash', arguments: { command } });
  let count = 0;
  pi.on('tool_call', event => {
    if (event.toolName === 'write' && event.input.path === path && event.input.content === content) return;
    if (event.toolName === 'bash' && (event.input.command === command ||
        process.env.PI_EMBEDDED_COMMAND_PLAIN && event.input.command === process.env.PI_EMBEDDED_COMMAND_PLAIN)) return;
    return { block: true, reason: 'Embedded proof permits only the exact draft write and local simulated-glab command.' };
  });
  if (process.env.PI_EMBEDDED_LIVE === '1') { extension(pi); return; }
  const fetchFixture: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    count++;
    let text: string;
    if (count === 1) text = `### Step 1: Write the comment to a temporary file\n\x60\x60\x60json\n${write}\n\x60\x60\x60\n### Step 2: Post the comment from the file\n\x60\x60\x60json\n${bash}\n\x60\x60\x60`;
    else if (count === 2) {
      const result = body.messages.findLast((message: any) => message.role === 'tool');
      assert.ok(result?.content.includes('Successfully wrote'), 'first real write must complete before bash is proposed again');
      text = `Now post the prepared comment:\n\x60\x60\x60json\n${bash}\n\x60\x60\x60`;
    } else {
      assert.equal(count, 3);
      const result = body.messages.findLast((message: any) => message.role === 'tool');
      assert.ok(result?.content.includes('SIMULATED_COMMENT_ACCEPTED'));
      text = 'The simulated destination accepted the comment.';
    }
    let wire = '';
    for (let index = 0; index < text.length; index += 11) wire += `data: ${JSON.stringify({ id: `embedded-${count}`, choices: [{ index: 0, delta: { content: text.slice(index, index + 11) }, finish_reason: null }] })}\n\n`;
    wire += `data: ${JSON.stringify({ id: `embedded-${count}`, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    return new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  extension({ on: pi.on.bind(pi), registerCommand: pi.registerCommand.bind(pi), registerProvider(name: string, config: ProviderConfig) {
    pi.registerProvider(name, { ...config, streamSimple: (model, context, options) => config.streamSimple!(model, context, { ...options, fetch: fetchFixture }) });
  } } as ExtensionAPI);
}
