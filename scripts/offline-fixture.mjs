// Test-only transport fixture; loaded into the Pi process, never by the extension.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
const realFetch = globalThis.fetch;
let count = 0;
export const fixtureFetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('http://pi-adapter-fixture.invalid/')) return realFetch(input, init);
  assert.equal(url, 'http://pi-adapter-fixture.invalid/v1/chat/completions');
  const body = JSON.parse(init.body);
  appendFileSync(process.env.PI_ADAPTER_FIXTURE_LOG, JSON.stringify(body) + '\n');
  assert.equal(body.stream, true);
  assert.deepEqual(body.tools.map(tool => tool.function.name), ['bash']);
  if (process.env.PI_ADAPTER_FIXTURE_SKILLS) {
    const instructions = JSON.stringify(body.messages.filter(message => ['system', 'developer'].includes(message.role)));
    assert.equal(instructions.includes('adapter-skill-sentinel'), process.env.PI_ADAPTER_FIXTURE_SKILLS === 'enabled',
      'skill discovery must follow --no-skills independently of the provider extension');
  }
  count++;
  let content;
  if (count === 1) {
    const call = '{"name":"bash","arguments":{"command":"printf pi_adapter_ok"}}';
    content = process.env.PI_ADAPTER_FIXTURE_STANDALONE === '1' ? call : `<function-call>${call}</function-call>`;
  }
  else {
    assert.equal(count, 2);
    const result = body.messages.findLast(message => message.role === 'tool');
    const assistant = body.messages.findLast(message => message.role === 'assistant');
    assert.ok(result.content.includes('pi_adapter_ok'));
    assert.equal(assistant.tool_calls[0].function.name, 'bash');
    assert.equal(result.tool_call_id, assistant.tool_calls[0].id);
    content = 'Pi received pi_adapter_ok.';
  }
  let wire = '';
  for (let i = 0; i < content.length; i += 7) wire += 'data: ' + JSON.stringify({ id: 'fixture',
    choices: [{ index: 0, delta: { content: content.slice(i, i + 7) }, finish_reason: null }] }) + '\n\n';
  wire += 'data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) + '\n\ndata: [DONE]\n\n';
  return new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } });
};
