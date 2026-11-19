import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const live = process.argv.includes('--live');
const offline = process.argv.includes('--offline');
const standaloneFixture = process.argv.includes('--standalone-fixture');
const withSkills = process.argv.includes('--with-skills');
assert.ok(!standaloneFixture || offline, '--standalone-fixture requires --offline');
assert.ok(!withSkills || standaloneFixture, '--with-skills requires --standalone-fixture');
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, '.pi-test'), { recursive: true });
const agentDir = await mkdtemp(resolve(root, '.pi-test/agent-'));
if (standaloneFixture) {
  const skillDir = resolve(agentDir, 'skills/adapter-skill-sentinel');
  await mkdir(skillDir, { recursive: true });
  await writeFile(resolve(skillDir, 'SKILL.md'),
    '---\nname: adapter-skill-sentinel\ndescription: Synthetic skill for verifying Pi skill discovery.\n---\nTest fixture only.\n');
}
const command = 'printf pi_adapter_ok';
const requests: Record<string, any>[] = [];
let fixtureError: unknown;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    assert.equal(body.stream, true);
    assert.deepEqual(body.tools.map((t: any) => t.function.name), ['bash']);
    let content: string;
    if (requests.length === 1) {
      content = '<function-call>' + JSON.stringify({ name: 'bash', arguments: { command } }) + '</function-call>';
    } else {
      assert.equal(requests.length, 2, 'unexpected extra model call');
      const result = body.messages.findLast((m: any) => m.role === 'tool');
      assert.ok(result?.content.includes('pi_adapter_ok'), 'tool result was returned to model');
      const assistant = body.messages.findLast((m: any) => m.role === 'assistant');
      assert.equal(assistant.tool_calls[0].function.name, 'bash');
      assert.equal(result.tool_call_id, assistant.tool_calls[0].id);
      content = 'Pi received pi_adapter_ok.';
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Fragment tags/JSON over SSE events to prove normalization waits for completion.
    for (let i = 0; i < content.length; i += 7) {
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: content.slice(i, i + 7) }, finish_reason: null }] })}\n\n`);
    }
    res.end(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\ndata: [DONE]\n\n`);
  } catch (error) { fixtureError = error; res.writeHead(500); res.end('fixture assertion failed'); }
});
if (!live && !offline) await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
const address = server.address();
const endpoint = live ? process.env.PI_LLAMACPP_BASE_URL ?? 'http://172.18.10.6:8080/v1'
  : offline ? 'http://pi-adapter-fixture.invalid/v1' : `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`;
try {
  if (live) {
    const response = await fetch(`${endpoint}/models`, { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `models endpoint: ${response.status}`);
  }
  const child = spawn('pi', ['--offline', '--no-extensions', '-e', resolve(root, offline ? 'scripts/fixture-extension.ts' : 'scripts/live-extension.ts'),
    ...(withSkills ? [] : ['--no-skills']), '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-mcp', '--no-session',
    '--tools', 'bash', '--provider', 'llamacpp-adapter', '--model',
    process.env.PI_LLAMACPP_MODEL ?? 'Qwen2.5-Coder-32B-Instruct-Q4_K_M', '--mode', 'json', '-p',
    `Invoke bash exactly once with command ${JSON.stringify(command)}. Then report its output. Do not invoke any other commands.`],
    { cwd: root, env: { ...process.env, PI_TELEMETRY: '0', PI_CODING_AGENT_DIR: agentDir, PI_LLAMACPP_BASE_URL: endpoint,
      ...(offline ? { PI_ADAPTER_FIXTURE_LOG: resolve(agentDir, 'requests.jsonl') } : {}),
      ...(standaloneFixture ? { PI_LLAMACPP_STANDALONE: '1',
        PI_ADAPTER_FIXTURE_STANDALONE: '1', PI_ADAPTER_FIXTURE_SKILLS: withSkills ? 'enabled' : 'disabled' } : {}) } });
  child.stdin.end();
  let stdout = ''; let stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), live ? 180000 : 30000);
  const code = await new Promise<number | null>((done, reject) => { child.on('error', reject); child.on('close', done); });
  clearTimeout(timer);
  await writeFile(resolve(agentDir, 'events.jsonl'), stdout);
  await writeFile(resolve(agentDir, 'stderr.txt'), stderr);
  if (fixtureError) throw fixtureError;
  assert.equal(code, 0, stderr || stdout);
  const events = stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const starts = events.filter(event => event.type === 'tool_execution_start');
  const ends = events.filter(event => event.type === 'tool_execution_end');
  assert.equal(starts.length, 1, `expected one Pi bash execution; inspect ${agentDir}`);
  assert.equal(starts[0].toolName, 'bash'); assert.equal(starts[0].args.command, command);
  assert.equal(ends.length, 1); assert.equal(ends[0].isError, false);
  assert.ok(JSON.stringify(ends[0].result).includes('pi_adapter_ok'));
  if (offline) assert.equal((await readFile(resolve(agentDir, 'requests.jsonl'), 'utf8')).trim().split('\n').length, 2);
  else if (!live) assert.equal(requests.length, 2);
  console.log(`${live ? 'LIVE' : offline ? 'TRANSPORT FIXTURE' : 'HTTP FIXTURE'} PASS: Pi executed one bash call and returned pi_adapter_ok. Evidence: ${agentDir}`);
  if (standaloneFixture) console.log(`Standalone JSON recovery passed; skill sentinel ${withSkills ? 'present without --no-skills' : 'absent with --no-skills'}.`);
} finally { server.close(); }
