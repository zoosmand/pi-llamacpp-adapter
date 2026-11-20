import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContext, type Model } from '@earendil-works/pi-ai';
import { streamAdapter as rawStreamAdapter } from '../src/extension.ts';
const streamAdapter: typeof rawStreamAdapter = (model, context, options, runtime = { isProjectTrusted: () => true }) => rawStreamAdapter(model, context, options, runtime);
const model: Model<'openai-completions'> = {
  id: 'test', name: 'test', api: 'openai-completions', provider: 'llamacpp-adapter',
  baseUrl: 'http://fixture.invalid/v1', reasoning: false, input: ['text'],
  contextWindow: 32768, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const context = normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
  tools: [{ name: 'bash', description: 'bash', parameters: { type: 'object',
    properties: { command: { type: 'string' } }, required: ['command'] } }] });
function response(text: string, finish = 'stop') {
  return new Response(`data: ${JSON.stringify({ id: 'test', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'test', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 } })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}
for (const text of ['', 'Hello 🌍\n', '{"result":42}', '<tool_call>{"name":"bash","arguments":{"command":"pwd"}}</tool_call>']) {
  test(`provider balanced events: ${text.slice(0,25)}`, async () => {
    const hooks: string[] = [];
    const stream = streamAdapter(model, context, { apiKey: 'local', fetch: async () => response(text),
      onPayload: payload => { hooks.push('payload'); return payload; },
      onResponse: () => { hooks.push('response'); }, onProviderStreamEvent: () => { hooks.push('event'); } });
    const events = []; for await (const event of stream) events.push(event);
    const result = await stream.result();
    assert.equal(events[0].type, 'start'); assert.equal(events.at(-1)?.type, 'done');
    assert.equal(events.filter(e => e.type === 'done').length, 1);
    assert.equal(result.usage.totalTokens, 16);
    assert.ok(hooks.includes('payload') && hooks.includes('response') && hooks.includes('event'));
    if (text.startsWith('<tool_call>')) {
      assert.equal(result.stopReason, 'toolUse');
      assert.deepEqual(events.map(e => e.type), ['start', 'toolcall_start', 'toolcall_delta', 'toolcall_end', 'done']);
    } else assert.equal(result.content.map(b => b.type === 'text' ? b.text : '').join(''), text);
  });
}
test('length-limited tool-looking output remains text', async () => {
  const stream = streamAdapter(model, context, { apiKey: 'local', fetch: async () => response('<tools>{"name":"bash","arguments":{"command":"pwd"}}</tools>', 'length') });
  const result = await stream.result(); assert.equal(result.stopReason, 'length');
  assert.equal(result.content[0].type, 'text');
});
test('aborted request emits one error and no recovered tool', async () => {
  const controller = new AbortController(); controller.abort();
  const stream = streamAdapter(model, context, { apiKey: 'local', signal: controller.signal,
    fetch: async () => { throw new DOMException('Aborted', 'AbortError'); } });
  const events = []; for await (const event of stream) events.push(event);
  assert.equal(events.filter(e => e.type === 'error').length, 1);
  assert.equal((await stream.result()).stopReason, 'aborted');
  assert.ok(!events.some(e => e.type === 'toolcall_end'));
});
