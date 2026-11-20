import { createTestArtifacts } from './test-artifacts.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RpcClient, type JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent';

const live = process.argv.includes('--live');
const root = resolve(import.meta.dirname, '..');
const evidence = await createTestArtifacts('embedded');
const body = '### Issue summary\n- Generate a session key via API.\n- Persist session results in SQLite.\n';
const cliPath = realpathSync(execFileSync('/usr/bin/which', ['pi'], { encoding: 'utf8' }).trim());
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

for (const trusted of live ? [true] : [false, true]) {
  const dir = resolve(evidence, trusted ? 'trusted' : 'untrusted');
  await mkdir(dir, { recursive: true });
  const draft = resolve(dir, 'comment.md');
  const posted = resolve(dir, 'simulated-post.json');
  const stub = resolve(dir, 'glab.mjs');
  await writeFile(stub, `#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
assert.deepEqual(process.argv.slice(2), ['issue', 'note', '6', '--repo', 'proof.invalid/test/project']);
const content = readFileSync(0, 'utf8');
assert.equal(content, ${JSON.stringify(body)});
writeFileSync(${JSON.stringify(posted)}, JSON.stringify({ simulated: true, content }));
console.log('SIMULATED_COMMENT_ACCEPTED');
`, { mode: 0o755 });
  const command = `${quote(stub)} issue note 6 --repo proof.invalid/test/project < ${quote(draft)}`;
  const events: JsonAgentSessionEvent[] = [];
  const client = new RpcClient({ cliPath, cwd: dir, provider: 'llamacpp-adapter', model: 'Qwen2.5-Coder-32B-Instruct-Q4_K_M',
    args: ['--offline', '--no-extensions', '-e', resolve(root, 'scripts/embedded-proof-extension.ts'),
      '--no-skills', '--no-context-files', '--no-mcp', '--no-prompt-templates', '--no-themes', '--tools', 'write,bash',
      trusted ? '--approve' : '--no-approve', '--session-dir', resolve(dir, 'sessions')],
    env: { PI_CODING_AGENT_DIR: resolve(dir, 'agent'), PI_TELEMETRY: '0', PI_LLAMACPP_BASE_URL: live ? process.env.PI_LLAMACPP_BASE_URL ?? 'http://172.18.10.6:8080/v1' : 'http://embedded.invalid/v1',
      PI_EMBEDDED_LIVE: live ? '1' : '0',
      PI_LLAMACPP_STANDALONE: '1', PI_LLAMACPP_FORMAT_RETRY: live ? '1' : '0', PI_LLAMACPP_EMBEDDED: '1',
      PI_EMBEDDED_DRAFT: draft, PI_EMBEDDED_BODY: body, PI_EMBEDDED_COMMAND: command,
      PI_EMBEDDED_COMMAND_PLAIN: /^[a-zA-Z0-9_./-]+$/.test(stub + draft) ? `${stub} issue note 6 --repo proof.invalid/test/project < ${draft}` : '' },
  });
  client.onEvent(event => { events.push(event); appendFileSync(resolve(dir, 'events.jsonl'), JSON.stringify(event) + '\n'); });
  const deadline = setTimeout(() => { void client.stop().finally(() => process.exit(1)); }, live ? 180000 : 30000);
  try {
    await client.start(); await client.setAutoRetry(false);
    const state = await client.getState();
    console.log(`${live ? 'LIVE Qwen' : 'FIXTURE'} comment submission proof; evidence: ${dir}`);
    const prompt = live ? `Post this exact multiline comment to the simulated issue #6. First write it to ${draft}, then submit it using this exact local test command: ${command}. This command targets a local simulation, not GitLab. Do not run any other commands. Comment text:\n${body}` : 'Prepare and submit this comment to the simulated test destination.';
    await client.promptAndWait(prompt, undefined, live ? 150000 : 15000);
    assert.equal((await client.getState()).sessionId, state.sessionId);
    const starts = events.filter(event => event.type === 'tool_execution_start');
    const ends = events.filter(event => event.type === 'tool_execution_end');
    if (!trusted) {
      assert.equal(starts.length, 0); assert.equal(existsSync(draft), false); assert.equal(existsSync(posted), false);
      assert.ok((await client.getLastAssistantText())?.includes('Step 1'));
    } else {
      assert.deepEqual(starts.map(event => event.toolName), ['write', 'bash']);
      assert.equal(ends.length, 2); assert.ok(ends.every(event => !event.isError));
      assert.equal(await readFile(draft, 'utf8'), body);
      assert.deepEqual(JSON.parse(await readFile(posted, 'utf8')), { simulated: true, content: body });
      const writeDone = events.findIndex(event => event.type === 'tool_execution_end' && event.toolName === 'write');
      const bashStart = events.findIndex(event => event.type === 'tool_execution_start' && event.toolName === 'bash');
      assert.ok(writeDone >= 0 && bashStart > writeDone, 'write result must precede bash execution');
      if (!live) assert.equal(await client.getLastAssistantText(), 'The simulated destination accepted the comment.');
    }
    await writeFile(resolve(dir, 'summary.json'), JSON.stringify({ mode: live ? 'live-qwen-local-simulation' : 'fixture-model-local-simulation', trusted, sessionId: state.sessionId, toolNames: starts.map(event => event.toolName), messages: await client.getMessages() }, null, 2));
    console.log(`PASS ${trusted ? (live ? 'trusted: real Qwen executed write then bash against local simulation' : 'trusted: narrated/fenced calls executed write then bash') : 'untrusted: response remained text, no tool execution'}. Evidence: ${dir}`);
  } finally { clearTimeout(deadline); await client.stop(); await writeFile(resolve(dir, 'stderr.txt'), client.getStderr()); }
}
