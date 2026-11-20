import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContext, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { formattingAttempt } from '../src/format-retry.ts';
import { streamAdapter as rawStreamAdapter } from '../src/extension.ts';
// Exercise the optional legacy-strict repair path; embedded recovery is covered separately.
process.env.PI_LLAMACPP_EMBEDDED = '0';
const streamAdapter: typeof rawStreamAdapter = (model, context, options, runtime = { isProjectTrusted: () => true }) => rawStreamAdapter(model, context, options, runtime);
const tools = [{ name: 'bash', description: 'shell', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }];
const call = '{"name":"bash","arguments":{"command":"git remote -v"}}';
const duplicate = `${call}\n\n${call}`;
const model: Model<'openai-completions'> = { id: 'test', name: 'test', api: 'openai-completions', provider: 'llamacpp-adapter',
  baseUrl: 'http://fixture.invalid/v1', reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const context = normalizeContext({ tools, messages: [{ role: 'user', content: 'Inspect remotes', timestamp: 1 }] });
function message(text: string): AssistantMessage {
  return { role: 'assistant', api: 'openai-completions', provider: 'llamacpp-adapter', model: 'test', timestamp: 0,
    content: [{ type: 'text', text }], stopReason: 'stop', usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0,
      totalTokens: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function response(text: string, finish = 'stop') {
  return new Response(`data: ${JSON.stringify({ id: 'test', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'test', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}
async function run(texts: string[], enabled: boolean, finish = 'stop', requestContext = context) {
  const old = process.env.PI_LLAMACPP_FORMAT_RETRY;
  process.env.PI_LLAMACPP_FORMAT_RETRY = enabled ? '1' : '0';
  const requests: any[] = [];
  try {
    const stream = streamAdapter(model, requestContext, { apiKey: 'local', fetch: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      assert.ok(requests.length <= texts.length, 'unexpected retry');
      return response(texts[requests.length - 1], requests.length === 2 ? finish : 'stop');
    } });
    const events = []; for await (const event of stream) events.push(event);
    return { result: await stream.result(), requests, events };
  } finally { if (old === undefined) delete process.env.PI_LLAMACPP_FORMAT_RETRY; else process.env.PI_LLAMACPP_FORMAT_RETRY = old; }
}
test('recognizes only strictly validated named or identical repeated calls', () => {
  assert.equal(formattingAttempt(message('bash: {"command":"git remote -v"}'), tools)?.name, 'bash');
  assert.equal(formattingAttempt(message(duplicate), tools)?.name, 'bash');
  for (const text of ['Explanation\n' + duplicate, '```json\n' + duplicate + '\n```', '{"ok":true}',
    'bash: {"command":42}', 'unknown: {"command":"pwd"}', call + '\n\n' + call.replace('git remote -v', 'pwd'),
    call + '\n\n' + 'text', 'bash: {"command":"pwd","extra":1}']) {
    assert.equal(formattingAttempt(message(text), tools), undefined, text);
  }
  assert.equal(formattingAttempt({ ...message(duplicate), stopReason: 'length' }, tools), undefined);
});
test('retry disabled preserves duplicate text and issues one request', async () => {
  const { result, requests } = await run([duplicate], false);
  assert.deepEqual(result.content, [{ type: 'text', text: duplicate }]); assert.equal(requests.length, 1);
});
test('one repair yields one matching call, one terminal event and combined usage', async () => {
  const { result, requests, events } = await run([duplicate, `<tool_call>${call}</tool_call>`], true);
  assert.equal(requests.length, 2); assert.equal(result.stopReason, 'toolUse');
  assert.equal(result.content.length, 1); assert.equal(result.usage.totalTokens, 14);
  assert.equal(events.filter(event => event.type === 'toolcall_end').length, 1);
  assert.equal(events.filter(event => event.type === 'done').length, 1);
  assert.ok(requests[1].messages.at(-1).content.includes('EXACT SAME arguments'));
  assert.equal(context.messages.length, 2, 'synthetic correction must not persist in transcript');
  assert.equal(requests[0].temperature, 0);
  assert.equal(requests[1].temperature, 0);
});
for (const repair of [duplicate, '<tools>{"name":"bash","arguments":{"command":"git push"}}</tools>',
  'Here is the call: ' + call, '{"ok":true}']) {
  test(`rejects unsuccessful/changed repair: ${repair.slice(0,50)}`, async () => {
    const { result, requests, events } = await run([duplicate, repair], true);
    assert.equal(requests.length, 2); assert.equal(result.stopReason, 'stop');
    assert.deepEqual(result.content, [{ type: 'text', text: duplicate }]);
    assert.equal(events.filter(event => event.type === 'toolcall_end').length, 0);
    assert.equal(result.usage.totalTokens, 14);
  });
}
test('truncated repair never becomes a call', async () => {
  const { result } = await run([duplicate, `<tools>${call}</tools>`], true, 'length');
  assert.deepEqual(result.content, [{ type: 'text', text: duplicate }]);
});
test('ordinary prose/JSON never requests a formatting repair', async () => {
  for (const text of ['Hello', '{"result":42}', 'Example:\n\n' + duplicate]) {
    const { requests, result } = await run([text], true);
    assert.equal(requests.length, 1); assert.deepEqual(result.content, [{ type: 'text', text }]);
  }
});

test('repair failure or cancellation emits one terminal error and no tool event', async () => {
  const old = process.env.PI_LLAMACPP_FORMAT_RETRY;
  process.env.PI_LLAMACPP_FORMAT_RETRY = '1';
  try {
    for (const abort of [false, true]) {
      const controller = new AbortController();
      let count = 0;
      const stream = streamAdapter(model, context, { apiKey: 'local', signal: controller.signal,
        fetch: async () => {
          count++;
          if (count === 1) return response(duplicate);
          if (abort) { controller.abort(); throw new DOMException('Aborted', 'AbortError'); }
          return new Response('{"error":{"message":"invalid request"}}', { status: 400, headers: { 'Content-Type': 'application/json' } });
        } });
      const events = []; for await (const event of stream) events.push(event);
      const result = await stream.result();
      assert.equal(result.stopReason, abort ? 'aborted' : 'error');
      assert.equal(count, 2);
      assert.equal(events.filter(event => event.type === 'error').length, 1);
      assert.equal(events.filter(event => event.type === 'toolcall_end' || event.type === 'done').length, 0);
      assert.ok(result.usage.totalTokens >= 7, 'failed repair must retain first request usage');
    }
  } finally { if (old === undefined) delete process.env.PI_LLAMACPP_FORMAT_RETRY; else process.env.PI_LLAMACPP_FORMAT_RETRY = old; }
});

test('retry mode honors an explicit caller temperature', async () => {
  const old = process.env.PI_LLAMACPP_FORMAT_RETRY;
  process.env.PI_LLAMACPP_FORMAT_RETRY = '1';
  const temperatures: number[] = [];
  try {
    const stream = streamAdapter(model, context, { apiKey: 'local', temperature: 0.25,
      fetch: async (_input, init) => {
        temperatures.push(JSON.parse(String(init?.body)).temperature);
        return response(temperatures.length === 1 ? duplicate : `<tools>${call}</tools>`);
      } });
    assert.equal((await stream.result()).stopReason, 'toolUse');
    assert.deepEqual(temperatures, [0.25, 0.25]);
  } finally { if (old === undefined) delete process.env.PI_LLAMACPP_FORMAT_RETRY; else process.env.PI_LLAMACPP_FORMAT_RETRY = old; }
});

const writeTool = { name: 'write', description: 'write', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } };
const writeContext = normalizeContext({ tools: [...tools, writeTool], messages: [{ role: 'user', content: 'Prepare a comment draft', timestamp: 1 }] });
const writeArguments = { path: '/tmp/proof-comment.md', content: '### Summary\n- SQLite session results\n\nQuote: "API"\n' };
const writeCall = JSON.stringify({ name: 'write', arguments: writeArguments });
test('single named write repair preserves exact multiline content', async () => {
  const { result, requests } = await run([`write: ${JSON.stringify(writeArguments)}`, `<tools>${writeCall}</tools>`], true, 'stop', writeContext);
  assert.equal(requests.length, 2);
  assert.equal(result.content[0].type, 'toolCall');
  if (result.content[0].type === 'toolCall') assert.deepEqual(result.content[0].arguments, writeArguments);
});
test('narrated write-then-post plan stays text even when both tools are declared', async () => {
  const text = '### Step 1: write the draft\n```json\n' + writeCall + '\n```\n### Step 2: post the comment\n```json\n' + call + '\n```';
  const { result, requests, events } = await run([text], true, 'stop', writeContext);
  assert.equal(requests.length, 1);
  assert.deepEqual(result.content, [{ type: 'text', text }]);
  assert.equal(events.filter(event => event.type === 'toolcall_end').length, 0);
});
