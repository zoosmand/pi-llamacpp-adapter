import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCall, normalizeMessage } from '../src/normalize.ts';
import type { AssistantMessage, Tool } from '@earendil-works/pi-ai';
export const tools: Tool[] = [{ name: 'bash', description: 'Run bash', parameters: {
  type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number', minimum: 1 } }, required: ['command'],
} }];
const json = JSON.stringify({ name: 'bash', arguments: { command: 'printf pi_adapter_ok' } });
for (const tag of ['tool_call', 'tools', 'function-call']) {
  test(`accepts ${tag}`, () => {
    const call = parseCall(`  <${tag}>\n${json}\n</${tag}> `, tools);
    assert.equal(call?.name, 'bash'); assert.deepEqual(call?.arguments, { command: 'printf pi_adapter_ok' });
  });
}
test('standalone requires explicit opt-in', () => {
  assert.equal(parseCall(json, tools), undefined);
  assert.equal(parseCall(json, tools, { allowStandalone: true })?.name, 'bash');
});
for (const text of ['', 'hello', '{"ok":true}', '[]', 'null', '42', `Example: ${json}`,
  `\x60\x60\x60json\n${json}\n\x60\x60\x60`, `<tool_call>${json}</tools>`,
  `<tools>${json}</tools> extra`, `<tools>${json.slice(0,-1)}</tools>`,
  `<tools>[${json}]</tools>`, `<tools>${json}${json}</tools>`,
  '<tools>{"name":"Bash","arguments":{"command":"pwd"}}</tools>',
  '<tools>{"name":"bash","arguments":{}}</tools>',
  '<tools>{"name":"bash","arguments":{"command":42}}</tools>',
  '<tools>{"name":"bash","arguments":{"command":"pwd","timeout":"5"}}</tools>',
  '<tools>{"name":"bash","arguments":{"command":"pwd","extra":true}}</tools>',
  '<tools>{"name":"bash","arguments":"{\\"command\\":\\"pwd\\"}"}</tools>',
  '<tools>{"name":"bash","arguments":{"command":"pwd"},"explanation":"example"}</tools>']) {
  test(`preserves false positive/malformed ${text.slice(0,60)}`, () => {
    assert.equal(parseCall(text, tools, { allowStandalone: true }), undefined);
  });
}
function message(text: string): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions',
    provider: 'llamacpp-adapter', model: 'test', timestamp: 1, stopReason: 'stop',
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
test('ordinary text/JSON preserved by identity including whitespace', () => {
  for (const text of ['hello\n', '  {"ok":true}\n', json, '<tools>bad</tools>']) {
    const input = message(text); assert.equal(normalizeMessage(input, tools), input);
  }
});
test('conversion preserves usage, sets toolUse and unique IDs', () => {
  const input = message(`<tools>${json}</tools>`);
  const a = normalizeMessage(input, tools); const b = normalizeMessage(input, tools);
  assert.equal(a.stopReason, 'toolUse'); assert.equal(a.usage, input.usage);
  assert.notDeepEqual(a.content, b.content); assert.equal(input.content[0].type, 'text');
});
test('truncated, error, aborted and mixed native output never converted', () => {
  for (const stopReason of ['length', 'error', 'aborted', 'pending'] as const) {
    const input = { ...message(`<tools>${json}</tools>`), stopReason };
    assert.equal(normalizeMessage(input, tools), input);
  }
  const input = message(`<tools>${json}</tools>`);
  input.content.push({ type: 'toolCall', id: 'native', name: 'bash', arguments: { command: 'pwd' } });
  assert.equal(normalizeMessage(input, tools), input);
});
test('disabled or ambiguous tool names fail closed', () => {
  assert.equal(parseCall(`<tools>${json}</tools>`, []), undefined);
  assert.equal(parseCall(`<tools>${json}</tools>`, [...tools,...tools]), undefined);
});
