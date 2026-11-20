import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import type { ExtensionAPI, ProviderConfig } from '@earendil-works/pi-coding-agent';
import extension from '../src/extension.ts';
import { guard } from './guard.ts';

export default function sessionFixture(pi: ExtensionAPI) {
  guard(pi);
  let count = 0;
  const token = process.env.PI_SESSION_TEST_TOKEN!;
  const fetchFixture: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'http://pi-session-fixture.invalid/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    appendFileSync(process.env.PI_SESSION_TEST_REQUESTS!, JSON.stringify(body) + '\n');
    const users = body.messages.filter((message: { role: string }) => message.role === 'user');
    assert.ok(JSON.stringify(users[0]).includes(token), 'first prompt must remain in history');
    assert.deepEqual(body.tools.map((tool: any) => tool.function.name), ['bash']);
    count++;
    let content: string;
    if (count === 1) {
      assert.equal(users.length, 1);
      content = 'Remembered.';
    } else if (count === 2) {
      assert.equal(users.length, 2);
      content = '{"name":"bash","arguments":{"command":"printf pi_adapter_ok"}}';
    } else {
      const result = body.messages.findLast((message: any) => message.role === 'tool');
      const assistant = body.messages.findLast((message: any) => message.role === 'assistant' && message.tool_calls?.length);
      assert.ok(result?.content.includes('pi_adapter_ok'));
      assert.equal(result.tool_call_id, assistant.tool_calls[0].id);
      assert.equal(JSON.parse(assistant.tool_calls[0].function.arguments).command, 'printf pi_adapter_ok');
      if (count === 3) {
        assert.equal(users.length, 2);
        content = 'pi_adapter_ok';
      } else {
        assert.equal(count, 4);
        assert.equal(users.length, 3);
        content = JSON.stringify({ token, bash_output: 'pi_adapter_ok' });
      }
    }
    let wire = '';
    for (let index = 0; index < content.length; index += 7) {
      wire += `data: ${JSON.stringify({ id: 'session-fixture', choices: [{ index: 0,
        delta: { content: content.slice(index, index + 7) }, finish_reason: null }] })}\n\n`;
    }
    wire += `data: ${JSON.stringify({ id: 'session-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    return new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  extension({ on: pi.on.bind(pi), registerCommand: pi.registerCommand.bind(pi), registerProvider(name: string, config: ProviderConfig) {
    pi.registerProvider(name, { ...config,
      streamSimple: (model, context, options) => config.streamSimple!(model, context, { ...options, fetch: fetchFixture }),
    });
  } } as ExtensionAPI);
}
