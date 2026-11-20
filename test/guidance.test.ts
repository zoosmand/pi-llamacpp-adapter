import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentSystemPrompt, getCurrentTools, normalizeContext } from '@earendil-works/pi-ai';
import { withToolGuidance } from '../src/guidance.ts';
const bash = { name: 'bash', description: 'shell', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } };
const read = { name: 'read', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };

test('adds tool protocol and glab guidance without changing transcript or declarations', () => {
  const context = normalizeContext({ systemPrompt: 'Follow project instructions.', tools: [bash], messages: [{ role: 'user', content: 'Read issue 6', timestamp: 1 }] });
  const snapshot = structuredClone(context);
  const result = withToolGuidance(context);
  const prompt = getCurrentSystemPrompt(result.messages);
  assert.ok(prompt.includes('Follow project instructions.'));
  assert.ok(prompt.includes('<tool_call>'));
  assert.ok(prompt.includes('glab issue view'));
  assert.ok(prompt.includes('observed remote'));
  assert.ok(!prompt.includes('HOST/GROUP/PROJECT'));
  assert.ok(!prompt.includes('DECLARED_TOOL_NAME'));
  assert.ok(prompt.includes('A 404 alone does not establish'));
  assert.ok(prompt.includes('Do not inspect branches'));
  assert.ok(prompt.includes('only when authorized'));
  assert.deepEqual(context, snapshot);
  assert.deepEqual(getCurrentTools(result.messages), [bash]);
  assert.equal(result.messages[1], context.messages[1]);
});
test('read-only tool set receives no glab/bash instructions', () => {
  const context = normalizeContext({ tools: [read], messages: [] });
  const prompt = getCurrentSystemPrompt(withToolGuidance(context).messages);
  assert.ok(prompt.includes('Tool execution protocol'));
  assert.ok(!prompt.includes('GitLab repository workflow'));
});
test('disabled guidance or no declared tools preserves context identity', () => {
  const context = normalizeContext({ tools: [bash], messages: [] });
  assert.equal(withToolGuidance(context, false), context);
  const noTools = normalizeContext({ messages: [] });
  assert.equal(withToolGuidance(noTools), noTools);
});
test('tool removal prevents glab guidance and repeated requests do not accumulate instructions', () => {
  const context = normalizeContext({ tools: [bash, read], messages: [] });
  context.messages.push({ role: 'system', content: '', timestamp: 1, toolsRemoved: [{ name: 'bash' }] });
  const prompt = getCurrentSystemPrompt(withToolGuidance(context).messages);
  assert.ok(!prompt.includes('GitLab repository workflow'));
  assert.equal(getCurrentSystemPrompt(withToolGuidance(context).messages), prompt);
});
test('sectioned and array system messages retain metadata and original text', () => {
  const context = normalizeContext({ tools: [bash], messages: [] });
  const first = context.messages[0];
  if (first.role !== 'system') throw new Error('Expected system message');
  first.content = [{ type: 'text', text: 'Original' }];
  first.sections = { rules: 'Approval required.' };
  const result = withToolGuidance(context);
  assert.ok(getCurrentSystemPrompt(result.messages).includes('Original'));
  assert.ok(getCurrentSystemPrompt(result.messages).includes('Approval required.'));
  assert.deepEqual(getCurrentTools(result.messages), [bash]);
  assert.equal(first.content.length, 1);
});
