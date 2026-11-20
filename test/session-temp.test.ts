import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createSessionTemp, registerSessionTemp } from '../src/session-temp.ts';

test('session directories are stable, isolated, private, and identifiers cannot escape root', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-session-temp-unit-')));
  try {
    const a = await createSessionTemp('one', root);
    await writeFile(join(a, 'comment.md'), 'kept');
    assert.equal(await createSessionTemp('one', root), a);
    assert.equal(await readFile(join(a, 'comment.md'), 'utf8'), 'kept');
    assert.notEqual(await createSessionTemp('two', root), a);
    assert.equal((await stat(a)).mode & 0o777, 0o700);
    const unsafe = await createSessionTemp('../../escape', root);
    assert.ok(!relative(root, unsafe).startsWith('..'));
    assert.equal(await createSessionTemp('../../escape', root), unsafe);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Pi lifecycle exposes the actual session path, switches/resumes correctly, and retains files', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-session-temp-unit-')));
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const notices: string[] = [];
  const api = {
    on(name: string, handler: Function) { handlers.set(name, handler); return () => {}; },
    registerCommand(name: string, command: unknown) { commands.set(name, command); },
  } as unknown as ExtensionAPI;
  let sessionId = 'one';
  const ctx = { sessionManager: { getSessionId: () => sessionId }, model: { provider: 'llamacpp-adapter' },
    hasUI: true, ui: { notify: (message: string) => notices.push(message) } };
  const previous = process.env.PI_SESSION_TMPDIR;
  try {
    registerSessionTemp(api, root);
    await handlers.get('session_start')!({}, ctx);
    const first = process.env.PI_SESSION_TMPDIR!;
    assert.ok(isAbsolute(first));
    await writeFile(join(first, 'draft.md'), 'saved');
    const event = { systemPrompt: 'Original prompt', systemPromptOptions: { sections: { original: 'Preserved' } } };
    await handlers.get('before_agent_start')!(event, ctx);
    assert.equal(process.env.PI_SESSION_TMPDIR, first);
    assert.equal(event.systemPromptOptions.sections.original, 'Preserved');
    assert.ok((event.systemPromptOptions.sections as any).pi_session_temp.includes(first));
    await commands.get('session-temp').handler('', ctx);
    assert.equal(notices.at(-1), first);
    await handlers.get('session_shutdown')!({}, ctx);
    assert.equal(await readFile(join(first, 'draft.md'), 'utf8'), 'saved');
    sessionId = 'two'; await handlers.get('session_start')!({}, ctx);
    assert.notEqual(process.env.PI_SESSION_TMPDIR, first);
    sessionId = 'one'; await handlers.get('session_start')!({}, ctx);
    assert.equal(process.env.PI_SESSION_TMPDIR, first);
    const forced = { systemPrompt: 'Exact custom prompt', systemPromptOptions: { sections: {}, forceSystemPrompt: 'Exact custom prompt' } };
    const result = await handlers.get('before_agent_start')!(forced, ctx);
    assert.ok(result.systemPrompt.startsWith('Exact custom prompt'));
    assert.ok(result.systemPrompt.includes(first));
    const other = { systemPrompt: 'Other provider', systemPromptOptions: { sections: {} } };
    await handlers.get('before_agent_start')!(other, { ...ctx, model: { provider: 'other' } });
    assert.deepEqual(other.systemPromptOptions.sections, {});
  } finally {
    if (previous === undefined) delete process.env.PI_SESSION_TMPDIR; else process.env.PI_SESSION_TMPDIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
