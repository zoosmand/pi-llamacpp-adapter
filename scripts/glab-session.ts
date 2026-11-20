import { createTestArtifacts } from './test-artifacts.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RpcClient, type JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent';

const prepareComment = process.argv.includes('--prepare-comment');
const root = resolve(import.meta.dirname, '..');
const repo = resolve(process.env.PI_GLAB_PROOF_REPO ?? resolve(root, '../loopback'));
const evidence = await createTestArtifacts('glab');
const commentPath = resolve(evidence, 'comment-draft.md');
const commentText = '### Understanding issue #6\n- Generate a session key via API.\n- Supply it in request headers for GUI control.\n- Store session results in SQLite.\n';
const before = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
const events: JsonAgentSessionEvent[] = [];
const client = new RpcClient({
  cliPath: realpathSync(execFileSync('/usr/bin/which', ['pi'], { encoding: 'utf8' }).trim()), cwd: repo,
  provider: 'llamacpp-adapter', model: process.env.PI_LLAMACPP_MODEL ?? 'Qwen2.5-Coder-32B-Instruct-Q4_K_M',
  args: ['--offline', '--no-extensions', '-e', resolve(root, 'scripts/glab-proof-extension.ts'),
    '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-mcp',
    '--session-dir', resolve(evidence, 'sessions'), '--tools', 'read,bash,edit,write'],
  env: { PI_CODING_AGENT_DIR: resolve(evidence, 'agent'), PI_TELEMETRY: '0',
    PI_LLAMACPP_BASE_URL: process.env.PI_LLAMACPP_BASE_URL ?? 'http://172.18.10.6:8080/v1',
    PI_LLAMACPP_STANDALONE: '1', PI_LLAMACPP_FORMAT_RETRY: '1', PI_LLAMACPP_GLAB_GUIDANCE: '1', PI_GLAB_PROOF_UPSTREAM: resolve(evidence, 'upstream.jsonl'),
    ...(prepareComment ? { PI_GLAB_PROOF_COMMENT: commentPath, PI_GLAB_PROOF_COMMENT_TEXT: commentText } : {}) },
});
client.onEvent(event => {
  events.push(event);
  appendFileSync(resolve(evidence, 'events.jsonl'), JSON.stringify(event) + '\n');
  if (event.type === 'tool_execution_start') console.log(`Pi executing: ${JSON.stringify(event.args)}`);
});
const deadline = setTimeout(() => { console.error(`Timed out; evidence: ${evidence}`); void client.stop().finally(() => process.exit(1)); }, 240000);
try {
  console.log(`LIVE glab proof in ${repo}; evidence: ${evidence}`);
  await client.start();
  await client.setAutoRetry(false);
  const initial = await client.getState();
  assert.ok(initial.sessionId);
  const prompts = [
    'Read the issue #6. Tell whether you understand the task.',
    'Without running more commands, which database does the issue require, how is the session key supplied by the calling service, and which interface uses it to control requests? Answer from the issue you just read.',
  ];
  if (prepareComment) prompts.push(`Prepare a comment for issue #6 but DO NOT POST it. Write the following exact text to ${commentPath}, then confirm the file was written. Text:\n${commentText}`);
  let answer = '';
  for (const [index, prompt] of prompts.entries()) {
    const turn = await client.promptAndWait(prompt, undefined, 100000);
    const state = await client.getState();
    assert.equal(state.sessionId, initial.sessionId);
    const failures = turn.filter(event => event.type === 'message_end' && event.message.role === 'assistant' && ['error', 'aborted', 'length'].includes(event.message.stopReason));
    assert.equal(failures.length, 0, JSON.stringify(failures));
    console.log(`Turn ${index + 1}: ${await client.getLastAssistantText()}`);
    if (index === 0) {
      const issueRead = events.find(event => event.type === 'tool_execution_end' && !event.isError &&
        JSON.stringify(event.result).includes('session key to be generated via API') && JSON.stringify(event.result).includes('SQLite'));
      assert.ok(issueRead, 'must receive actual glab issue content before answering');
    } else if (index === 1) {
      assert.equal(turn.filter(event => event.type === 'tool_execution_start').length, 0, 'follow-up must use retained history');
      answer = await client.getLastAssistantText() ?? '';
    } else {
      const writes = turn.filter(event => event.type === 'tool_execution_start');
      assert.equal(writes.length, 1, 'must actually write one draft file');
      assert.equal(writes[0].toolName, 'write');
      assert.equal(await readFile(commentPath, 'utf8'), commentText, 'draft must preserve exact multiline content');
    }
  }
  const starts = events.filter(event => event.type === 'tool_execution_start');
  assert.ok(starts.length >= 2);
  assert.ok(JSON.stringify(starts[0].args).includes('git remote -v'), 'must discover the repository before GitLab calls');
  assert.ok(!starts.some(event => JSON.stringify(event.args).includes('HOST/GROUP/PROJECT') || JSON.stringify(event.args).includes('git branch')), 'must not execute placeholders or drift into branch inspection');
  assert.ok(starts.some(event => JSON.stringify(event.args).includes('glab issue view') && JSON.stringify(event.args).includes('--repo gitlab.intraclear.com/infra/loopback')));
  assert.equal(events.filter(event => event.type === 'tool_execution_end' && event.isError).length, 0, 'no failed or blocked commands expected');
  assert.match(answer, /SQLite/i); assert.match(answer, /header/i); assert.match(answer, /GUI|graphical/i);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), before);
  await writeFile(resolve(evidence, 'summary.json'), JSON.stringify({ sessionId: initial.sessionId, answer, ...(prepareComment ? { commentPath, commentText } : {}),
    commands: starts.map(event => event.args), messages: await client.getMessages() }, null, 2));
  if (prepareComment) console.log('PASS: one real draft write with exact multiline text; no comment posted.');
  console.log(`PASS: Qwen used glab through Pi, read issue #6, and answered a follow-up in the same session. Evidence: ${evidence}`);
} finally {
  clearTimeout(deadline);
  await client.stop();
  await writeFile(resolve(evidence, 'stderr.txt'), client.getStderr());
}
