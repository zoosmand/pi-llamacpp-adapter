import { createTestArtifacts } from './test-artifacts.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RpcClient } from '@earendil-works/pi-coding-agent';

const live = process.argv.includes('--live');
const root = resolve(import.meta.dirname, '..');
const evidence = await createTestArtifacts('session');
const token = `session_${randomUUID()}`;
const endpoint = live ? process.env.PI_LLAMACPP_BASE_URL ?? 'http://172.18.10.6:8080/v1' : 'http://pi-session-fixture.invalid/v1';
const client = new RpcClient({
  cliPath: realpathSync(execFileSync('/usr/bin/which', ['pi'], { encoding: 'utf8' }).trim()),
  cwd: root, provider: 'llamacpp-adapter',
  model: process.env.PI_LLAMACPP_MODEL ?? 'Qwen2.5-Coder-32B-Instruct-Q4_K_M',
  args: ['--offline', '--no-extensions', '-e', resolve(root, live ? 'scripts/live-extension.ts' : 'scripts/session-fixture.ts'),
    '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-mcp',
    '--session-dir', resolve(evidence, 'sessions'), '--tools', 'bash'],
  env: { PI_CODING_AGENT_DIR: resolve(evidence, 'agent'), PI_TELEMETRY: '0',
    PI_LLAMACPP_STANDALONE: '1', PI_LLAMACPP_BASE_URL: endpoint,
    PI_SESSION_TEST_TOKEN: token, PI_SESSION_TEST_REQUESTS: resolve(evidence, 'requests.jsonl') },
});
client.onEvent(event => appendFileSync(resolve(evidence, 'events.jsonl'), JSON.stringify(event) + '\n'));
const deadline = setTimeout(() => { console.error(`Session test timed out; evidence: ${evidence}`); void client.stop().finally(() => process.exit(1)); }, live ? 240000 : 30000);
try {
  console.log(`${live ? 'LIVE' : 'FIXTURE'} single-session test; evidence: ${evidence}`);
  await client.start();
  await client.setAutoRetry(false);
  const initial = await client.getState();
  assert.ok(initial.sessionId);
  assert.equal(initial.model?.provider, 'llamacpp-adapter');
  const prompts = [
    `Remember this token for this conversation: ${token}. Reply only Remembered. Do not call tools.`,
    'Invoke bash exactly once with command "printf pi_adapter_ok". Then report its output. Do not invoke any other commands.',
    'Without calling any tools, return only a JSON object with keys "token" and "bash_output", using the token I asked you to remember and the output of the bash command from this conversation.',
  ];
  const states = [initial];
  for (const [index, prompt] of prompts.entries()) {
    const events = await client.promptAndWait(prompt, undefined, live ? 75000 : 10000);
    const errors = events.filter(event => event.type === 'message_end' && event.message.role === 'assistant' &&
      ['error', 'aborted', 'length'].includes(event.message.stopReason));
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const state = await client.getState();
    assert.equal(state.sessionId, initial.sessionId, 'session must stay unchanged');
    assert.equal(state.isStreaming, false);
    states.push(state);
    console.log(`Turn ${index + 1}/3 settled in session ${state.sessionId}: ${await client.getLastAssistantText()}`);
  }
  const messages = await client.getMessages();
  assert.equal(messages.filter(message => message.role === 'user').length, 3);
  const calls = messages.flatMap(message => message.role === 'assistant' ? message.content.filter(block => block.type === 'toolCall') : []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'bash');
  assert.deepEqual(calls[0].arguments, { command: 'printf pi_adapter_ok' });
  const results = messages.filter(message => message.role === 'toolResult');
  assert.equal(results.length, 1);
  assert.equal(results[0].isError, false);
  assert.equal(results[0].toolCallId, calls[0].id);
  assert.ok(JSON.stringify(results[0].content).includes('pi_adapter_ok'));
  const last = messages.at(-1);
  assert.equal(last?.role, 'assistant');
  if (last?.role !== 'assistant') throw new Error('Missing final assistant');
  assert.ok(last.content.every(block => block.type === 'text'), 'ordinary JSON must stay text');
  assert.deepEqual(JSON.parse(await client.getLastAssistantText() ?? ''), { token, bash_output: 'pi_adapter_ok' });
  if (!live) assert.equal((await readFile(resolve(evidence, 'requests.jsonl'), 'utf8')).trim().split('\n').length, 4);
  await writeFile(resolve(evidence, 'summary.json'), JSON.stringify({ mode: live ? 'live' : 'fixture',
    sessionId: initial.sessionId, states, messages, checks: ['three prompts', 'same session', 'one bash invocation', 'matching tool result', 'recalled token/output', 'ordinary JSON preserved'] }, null, 2));
  console.log(`PASS: three turns, one session, one successful bash invocation, retained history and JSON preserved. Evidence: ${evidence}`);
} finally {
  clearTimeout(deadline);
  await client.stop();
  await writeFile(resolve(evidence, 'stderr.txt'), client.getStderr());
}
