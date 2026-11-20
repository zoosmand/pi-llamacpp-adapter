# pi-llamacpp-adapter

Minimal TypeScript provider extension for Pi 1.5.2 on Node 24. It recovers Qwen tool calls delivered as assistant text, without changing Pi or llama.cpp. Command execution, enabled tools, and any permission extensions remain controlled by Pi.

## Run

```sh
cd pi-llamacpp-adapter
npm install
npm run build
npm test
npm run test:e2e:offline
```

Use the extension explicitly; no global installation or `models.json` edit is required:

```sh
pi -e ./src/extension.ts \
  --provider llamacpp-adapter \
  --model Qwen2.5-Coder-32B-Instruct-Q4_K_M
```

Defaults are `http://172.18.10.6:8080/v1` and the model ID above. Override with `PI_LLAMACPP_BASE_URL` and `PI_LLAMACPP_MODEL` (use the exact ID exposed by `/v1/models`). The initial context/output limits are 32768/4096 tokens; check these against the loaded server before larger sessions. The local unauthenticated endpoint uses a dummy `local` API key.

If package downloads are unavailable but Pi is already globally installed, `node scripts/use-installed-pi.mjs` links its runtime packages into this project's ignored `node_modules`; `npm test` and the proof scripts then work without installing another Pi. A TypeScript compiler is still needed for `npm run build`.

## Running without skills

This command keeps the adapter active while disabling automatic Pi skill discovery:

```sh
PI_LLAMACPP_STANDALONE=1 pi -e ./src/extension.ts --no-skills \
  --provider llamacpp-adapter --model Qwen2.5-Coder-32B-Instruct-Q4_K_M
```

In Pi 1.5.2, `-e` loads a provider **extension** independently of skills. `--no-skills` does not disable provider registration, standalone JSON normalization, built-in tools such as `bash`, or Pi's tool execution controls. The adapter does not load skills itself.

`--no-skills` suppresses automatically discovered skills, including Postman skills if installed as Pi skills. Explicit `--skill` paths can still load; omit them to keep skills disabled. This flag does not disable other extensions, MCP integrations, prompt templates, or `AGENTS.md`/`CLAUDE.md` context. It also does not change the skills available to the separate coding assistant developing this project. Current repository instructions separately exclude Postman skills from our development work.

`npm run test:skills` checks standalone tool recovery through the installed Pi twice: with `--no-skills` (a synthetic skill must be absent from model instructions), and without it (the same skill must be present). Both runs must execute the same single bash command through Pi.

## Response contract

In a project that Pi reports as trusted, the adapter recognizes complete, validated tool-call objects in standalone JSON, tagged responses, prose, and Markdown code fences:

```json
{"name":"bash","arguments":{"command":"printf pi_adapter_ok"}}
```

The name must match exactly one currently declared Pi tool. Arguments must be an object matching that tool's JSON Schema without coercion, defaults, or repair. Extra top-level argument properties are rejected; nested properties follow their declared schemas. The adapter converts the call to Pi's native tool-call events and sets `toolUse`; Pi executes it and returns the result to the model.

A response proposing several actions dispatches only the first validated call. This prevents dependent actions such as writing a comment file and submitting it from running concurrently. After Pi returns the first result, Qwen decides the next action from the user request. Duplicate proposals are dispatched once per response, not as a batch.

Ordinary text and non-tool JSON remain unchanged. Complete JSON data objects/arrays containing nested tool-call examples are not searched recursively. Invalid arguments, unknown tools, malformed JSON, and truncated/error responses are not executed. In trusted mode a top-level object with a valid `name` and `arguments` is an executable envelope even in a fence; use an enclosing data object when requesting literal examples.

Trust comes from Pi's `ctx.isProjectTrusted()`, including its remembered decisions and CLI overrides. The adapter never grants trust. In an untrusted project recovered responses remain text, and its `tool_call` hook blocks execution for this provider, including native calls. Existing Pi permission handlers still apply in trusted projects.

Embedded recovery is enabled by default for trusted projects and works with `--no-skills`. Set `PI_LLAMACPP_EMBEDDED=0` to restore whole-response recognition; in that legacy mode standalone JSON requires `PI_LLAMACPP_STANDALONE=1`, while supported tags remain recognized. See [recovery and trust details](docs/tool-recovery.md).

## Proof commands

```sh
npm run test:e2e:offline # Real installed Pi + fixture injected through its fetch option
npm run test:e2e         # Real installed Pi + local HTTP/SSE fixture
npm run test:live        # Real installed Pi + configured llama.cpp endpoint
npm run test:embedded    # Prose/fences: real Pi write -> bash, trusted/untrusted, local fake glab
npm run test:embedded:live # Real Qwen write -> bash submission to local fake glab
npm run test:skills      # Skills disabled/enabled control through installed Pi
npm run test:session     # Three prompts in one Pi process/session
npm run test:session-temp # Session-specific paths, resume and artifact retention
```

The original e2e/live printf proofs declare only `bash`. A test-only Pi `tool_call` handler permits exactly `printf pi_adapter_ok` once and blocks other calls. The scripts check one execution, its actual result, and (for fixtures) the second model request containing the tool result and matching ID. They use isolated configuration and evidence directories under the OS temporary root (`pi-llamacpp-adapter-tests`), and print their full paths. They neither disable Pi permission hooks nor install global configuration. The standalone setting is inherited for legacy strict mode. The embedded proof uses Pi's explicit per-run trust/decline flags to check both trust outcomes.

The offline fixture uses the same provider registration and Pi OpenAI request/SSE conversion; it replaces only network transport. The HTTP fixture additionally exercises sockets. The live proof alone verifies interaction with your loaded Qwen model and chat template. Pi's `--offline` flag in these scripts suppresses startup discovery network calls; it does not prevent model requests.

See [architecture and API inspection](docs/architecture.md) and [verification evidence](docs/verification.md).

## GitLab repository operations

The adapter supplies tool-use and `glab` guidance independently of skills. Qwen uses Pi's declared bash tool, discovers the Git remote, and selects the GitLab repository explicitly. For remaining named-prefix or legacy strict-format responses, `PI_LLAMACPP_FORMAT_RETRY=1` enables one constrained formatting retry; it is disabled by default. See [glab setup, safeguards, and live verification](docs/glab.md).

## Session temporary files

Temporary artifacts default to a private OS directory dedicated to the current Pi session, outside the repository. Run `/session-temp` to display its path; Pi bash tools can use `$PI_SESSION_TMPDIR`. Qwen receives the real directory in its instructions. New sessions get separate directories; resumed sessions reuse theirs, and files are retained after exit. See [session temporary files and proof commands](docs/session-temp.md).

## Multiple turns in one session

`npm run test:session` runs three consecutive prompts through one long-lived Pi RPC process with fixture transport. `npm run test:session:live` runs the same checks against the configured llama.cpp endpoint. Both keep `--no-skills` and `PI_LLAMACPP_STANDALONE=1` enabled, permit only one harmless bash command through Pi, and check session identity, retained conversation history, and ordinary JSON output. See [single-session results](docs/session-testing.md).
