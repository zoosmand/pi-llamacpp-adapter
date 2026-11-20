import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerTrustGate } from '../src/trust.ts';

test('observes Pi trust without granting it and rechecks at tool execution', () => {
  const handlers = new Map<string, Function>();
  const api = { on(name: string, handler: Function) { handlers.set(name, handler); return () => {}; } } as unknown as ExtensionAPI;
  const isTrusted = registerTrustGate(api);
  let trusted = false;
  const ctx = { isProjectTrusted: () => trusted, model: { provider: 'llamacpp-adapter' } };
  assert.equal(isTrusted(), false);
  handlers.get('session_start')!({}, ctx); assert.equal(isTrusted(), false);
  trusted = true; handlers.get('before_agent_start')!({}, ctx); assert.equal(isTrusted(), true);
  const event = { toolCallId: 'adapter_test', toolName: 'bash', input: { command: 'pwd' } };
  assert.equal(handlers.get('tool_call')!(event, ctx), undefined);
  trusted = false;
  assert.equal(isTrusted(), false);
  assert.equal(handlers.get('tool_call')!(event, ctx).block, true);
  assert.equal(handlers.get('tool_call')!({ ...event, toolCallId: 'native' }, ctx).block, true);
  assert.equal(handlers.get('tool_call')!({ ...event, toolCallId: 'native' }, { ...ctx, model: { provider: 'other' } }), undefined);
  assert.equal(handlers.has('project_trust'), false, 'must not automatically approve the project');
});
