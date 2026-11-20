import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { normalizeContext } from '@earendil-works/pi-ai';
import { normalizeMessage, parseEmbeddedCall } from '../src/normalize.ts';
import { streamAdapter } from '../src/extension.ts';
const tools = [
  { name: 'bash', description: 'shell', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'write', description: 'write', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
];
const bash = JSON.stringify({ name: 'bash', arguments: { command: 'printf "{quoted}"' } });
const write = JSON.stringify({ name: 'write', arguments: { path: '/tmp/draft', content: 'Summary\n- SQLite\nQuote: "API" and {braces}\n' } });
const plan = `### Step 1\n\x60\x60\x60json\n${write}\n\x60\x60\x60\n### Step 2\n\x60\x60\x60json\n${bash}\n\x60\x60\x60`;
function message(text: string): AssistantMessage {
  return { role: 'assistant', api: 'openai-completions', provider: 'llamacpp-adapter', model: 'test', timestamp: 0,
    content: [{ type: 'text', text }], stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
for (const text of [bash, `Run this now: ${bash}`, `\x60\x60\x60json\n${bash}\n\x60\x60\x60`, `Call: <function-call>${bash}</function-call>`, `See [notes](https://example.invalid). Run ${bash}`]) {
  test(`recognizes embedded bash: ${text.slice(0,40)}`, () => {
    const result = normalizeMessage(message(text), tools, { allowEmbedded: true });
    assert.equal(result.stopReason, 'toolUse'); assert.equal(result.content[0].type, 'toolCall');
    if (result.content[0].type === 'toolCall') assert.deepEqual(result.content[0].arguments, { command: 'printf "{quoted}"' });
  });
}
test('a narrated dependent plan dispatches only the first validated action', () => {
  const result = normalizeMessage(message(plan), tools, { allowEmbedded: true });
  assert.equal(result.content.length, 1); assert.equal(result.content[0].type, 'toolCall');
  if (result.content[0].type === 'toolCall') {
    assert.equal(result.content[0].name, 'write');
    assert.equal(result.content[0].arguments.content, 'Summary\n- SQLite\nQuote: "API" and {braces}\n');
  }
});
test('duplicate proposed calls produce only one dispatch', () => {
  const result = normalizeMessage(message(`${bash}\n\n${bash}`), tools, { allowEmbedded: true });
  assert.equal(result.content.length, 1); assert.equal(result.stopReason, 'toolUse');
});
for (const text of ['Ordinary text', '{"ok":true}', JSON.stringify({ example: JSON.parse(bash) }), `[${bash}]`, `Data: [${bash}]`,
  '{"name":"bash","arguments":{"command":42}}', 'Text {"name":"unknown","arguments":{}}',
  'Text {"name":"bash","arguments":{"command":"pwd","extra":true}}',
  'Text {"name":"bash","arguments":{"command":"pwd"}',
  `Text ${bash}\n{"name":"bash","arguments":{}}`]) {
  test(`preserves data or invalid envelope: ${text.slice(0,40)}`, () => {
    const input = message(text); assert.equal(normalizeMessage(input, tools, { allowEmbedded: true }), input);
  });
}
test('legacy strict mode still preserves a narrated/fenced plan', () => {
  const input = message(plan); assert.equal(normalizeMessage(input, tools), input);
});
test('does not recover calls from truncated or native mixed messages', () => {
  for (const stopReason of ['length', 'error', 'aborted'] as const) {
    const input = { ...message(plan), stopReason };
    assert.equal(normalizeMessage(input, tools, { allowEmbedded: true }), input);
  }
  assert.equal(parseEmbeddedCall(`Text ${bash}`, [...tools, tools[0]]), undefined);
});
async function providerResponse(text: string, mode: { embedded?: string; standalone?: string; trusted?: () => boolean; native?: boolean } = {}) {
  const context = normalizeContext({ tools, messages: [{ role: 'user', content: 'Inspect the response', timestamp: 1 }] });
  const keys = ['PI_LLAMACPP_EMBEDDED', 'PI_LLAMACPP_STANDALONE', 'PI_LLAMACPP_FORMAT_RETRY'];
  const saved = keys.map(key => process.env[key]);
  const values = [mode.embedded, mode.standalone, '0'];
  keys.forEach((key, index) => { if (values[index] === undefined) delete process.env[key]; else process.env[key] = values[index]; });
  try {
    const delta = mode.native ? { tool_calls: [{ index: 0, id: 'native_example', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'pwd' }) } }] } : { content: text };
    const wire = `data: ${JSON.stringify({ id: 'test', choices: [{ index: 0, delta, finish_reason: mode.native ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`;
    const stream = streamAdapter({ id: 'test', name: 'test', api: 'openai-completions', provider: 'llamacpp-adapter', baseUrl: 'http://fixture.invalid/v1',
      reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    context, { apiKey: 'local', fetch: async () => new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }) }, { isProjectTrusted: mode.trusted ?? (() => true) });
    const events = []; for await (const event of stream) events.push(event);
    return { result: await stream.result(), events };
  } finally { keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }); }
}

test('provider requires trust for recovered whole and explicitly opted-in embedded calls', async () => {
  for (const trusted of [false, true]) for (const text of ['Execute:\n```json\n' + bash + '\n```', '<tools>' + bash + '</tools>']) {
    const { result, events } = await providerResponse(text, { embedded: '1', trusted: () => trusted });
    assert.equal(result.stopReason, trusted ? 'toolUse' : 'stop');
    assert.equal(events.filter(event => event.type === 'toolcall_end').length, trusted ? 1 : 0);
  }
});
for (const text of [
  'For documentation only:\n```json\n{"name":"bash","arguments":{"command":"echo SHOULD_NOT_RUN"}}\n```',
  'Do NOT run: {"name":"bash","arguments":{"command":"bad"}}\nInstead: {"name":"bash","arguments":{"command":"good"}}',
  'The file says:\n```json\n{"name":"bash","arguments":{"command":"rm -rf build"}}\n```\nThat is just an example.',
]) {
  test(`default trusted provider preserves quoted/rejected call examples: ${text.slice(0,30)}`, async () => {
    const { result, events } = await providerResponse(text);
    assert.deepEqual(result.content, [{ type: 'text', text }]);
    assert.equal(result.stopReason, 'stop');
    assert.equal(events.filter(event => event.type === 'toolcall_end').length, 0);
  });
}
test('default tagged recovery and explicitly enabled whole-response JSON remain supported', async () => {
  assert.equal((await providerResponse(`<tool_call>${bash}</tool_call>`)).result.stopReason, 'toolUse');
  assert.equal((await providerResponse(bash, { standalone: '1' })).result.stopReason, 'toolUse');
});
test('native calls remain native even when project trust is false', async () => {
  const { result } = await providerResponse('', { native: true, trusted: () => false });
  assert.equal(result.stopReason, 'toolUse');
  assert.equal(result.content[0].type, 'toolCall');
  if (result.content[0].type === 'toolCall') assert.equal(result.content[0].id, 'native_example');
});
test('one response snapshots runtime trust once; dispatch trust is checked separately', async () => {
  let reads = 0;
  const { result } = await providerResponse(`<tools>${bash}</tools>`, { trusted: () => ++reads === 1 });
  assert.equal(result.stopReason, 'toolUse'); assert.equal(reads, 1);
});
