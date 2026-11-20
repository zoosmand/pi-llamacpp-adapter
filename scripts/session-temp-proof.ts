import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { RpcClient, type JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { createTestArtifacts } from './test-artifacts.ts';

const live = process.argv.includes('--live');
const root = resolve(import.meta.dirname, '..');
const evidence = await createTestArtifacts('session-temp');
const content = 'Session comment draft.\nStore results in SQLite.';
const client = new RpcClient({
  cliPath: realpathSync(execFileSync('/usr/bin/which', ['pi'], { encoding: 'utf8' }).trim()), cwd: root,
  provider: 'llamacpp-adapter', model: process.env.PI_LLAMACPP_MODEL ?? 'Qwen2.5-Coder-32B-Instruct-Q4_K_M',
  args: ['--offline', '--no-extensions', '-e', resolve(root, 'scripts/session-temp-proof-extension.ts'), '--no-skills',
    '--no-context-files', '--no-mcp', '--no-themes', '--no-prompt-templates', '--approve', '--tools', 'write,bash',
    '--session-dir', resolve(evidence, 'sessions')],
  env: { PI_CODING_AGENT_DIR: resolve(evidence, 'agent'), PI_TELEMETRY: '0',
    PI_LLAMACPP_BASE_URL: live ? process.env.PI_LLAMACPP_BASE_URL ?? 'http://172.18.10.6:8080/v1' : 'http://temp-proof.invalid/v1',
    PI_TEMP_PROOF_LIVE: live ? '1' : '0', PI_TEMP_PROOF_TEXT: content, PI_LLAMACPP_STANDALONE: '1', PI_LLAMACPP_FORMAT_RETRY: live ? '1' : '0' },
});
const events: JsonAgentSessionEvent[] = [];
client.onEvent(event => { events.push(event); appendFileSync(resolve(evidence, 'events.jsonl'), JSON.stringify(event) + '\n'); });
const deadline = setTimeout(() => { void client.stop().finally(() => process.exit(1)); }, live ? 180000 : 30000);
async function turn(prompt: string) {
  const result = await client.promptAndWait(prompt, undefined, live ? 60000 : 10000);
  assert.equal(result.filter(event => event.type === 'tool_execution_end' && event.isError).length, 0, JSON.stringify(result));
  return result;
}
async function tempPath() {
  const result = await turn('Report your temp path using bash. Run exactly: printf \'%s\' "$PI_SESSION_TMPDIR". Do not run any other commands.');
  const end = result.find(event => event.type === 'tool_execution_end' && event.toolName === 'bash');
  assert.ok(end && end.type === 'tool_execution_end');
  const directory = end.result.content.flatMap((block: { type: string; text?: string }) => block.type === 'text' ? [block.text ?? ''] : []).join('').trim();
  assert.ok(isAbsolute(directory));
  const inside = relative(await realpath(root), await realpath(directory));
  assert.ok(inside.startsWith('..') || isAbsolute(inside), 'session directory must be outside repository');
  return directory;
}
async function draft(directory: string) {
  const result = await turn(`Prepare a temporary issue comment draft containing exactly the text below. Do not post it. Save the file and report its full path.\n${content}`);
  const start = result.find(event => event.type === 'tool_execution_start' && event.toolName === 'write');
  assert.ok(start && start.type === 'tool_execution_start', 'model must invoke write rather than only print a proposal');
  const path = String((start.args as { path: string }).path);
  const inside = relative(directory, path);
  assert.ok(inside && inside !== '..' && !inside.startsWith('../') && !isAbsolute(inside));
  assert.equal(await readFile(path, 'utf8'), content);
  return path;
}
let saved: { first: string; second: string; firstDraft: string; secondDraft: string } | undefined;
try {
  console.log(`${live ? 'LIVE' : 'FIXTURE'} session-temp proof; evidence: ${evidence}`);
  await client.start(); await client.setAutoRetry(false);
  assert.ok((await client.getCommands()).some(command => command.name === 'session-temp'));
  const first = await tempPath();
  const firstDraft = await draft(first);
  const firstState = await client.getState();
  assert.ok(firstState.sessionFile);
  assert.equal(await client.prompt('/session-temp'), 'handled');
  assert.equal((await client.newSession()).cancelled, false);
  const second = await tempPath();
  assert.notEqual(second, first);
  const secondDraft = await draft(second);
  assert.equal((await client.switchSession(firstState.sessionFile!)).cancelled, false);
  assert.equal((await client.getState()).sessionId, firstState.sessionId);
  assert.equal(await tempPath(), first, 'resume must restore the original path');
  assert.equal(await readFile(firstDraft, 'utf8'), content);
  saved = { first, second, firstDraft, secondDraft };
  await writeFile(resolve(evidence, 'summary.json'), JSON.stringify({ mode: live ? 'live' : 'fixture', ...saved }, null, 2));
} finally { clearTimeout(deadline); await client.stop(); await writeFile(resolve(evidence, 'stderr.txt'), client.getStderr()); }
assert.ok(saved);
assert.equal(await readFile(saved.firstDraft, 'utf8'), content, 'shutdown must retain draft');
assert.equal(await readFile(saved.secondDraft, 'utf8'), content);
console.log(`PASS: temporary drafts outside repo, session isolation, environment, /session-temp, resume and retention. ${JSON.stringify(saved)}`);
