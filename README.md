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

## Response contract

A recovered call must occupy the entire assistant text (surrounding whitespace allowed) and contain exactly:

```json
{"name":"bash","arguments":{"command":"printf pi_adapter_ok"}}
```

Supported wrappers are `<tool_call>…</tool_call>`, `<tools>…</tools>`, and `<function-call>…</function-call>`. The name must match exactly one currently declared Pi tool. Arguments must be an object matching that tool's JSON Schema without coercion, defaults, or repair. Extra top-level argument properties are rejected. Nested properties follow the tool schema, including explicit dictionaries.

Ordinary text, JSON, whitespace, fenced examples, prose containing a call, malformed input, unknown tools, invalid arguments, arrays, multiple calls, and truncated responses stay unchanged. Native `tool_calls` follow Pi's existing validation/execution path. Recovery only runs on successful text-only responses.

Standalone JSON recovery requires `PI_LLAMACPP_STANDALONE=1`:

```sh
PI_LLAMACPP_STANDALONE=1 pi -e ./src/extension.ts \
  --provider llamacpp-adapter --model Qwen2.5-Coder-32B-Instruct-Q4_K_M
```

A JSON answer identical to a valid tool invocation cannot be distinguished from a tool invocation by syntax. With standalone recovery enabled, that exact shape becomes executable through Pi; other JSON remains text. Leave it disabled when requesting JSON examples or data. Tagged responses also establish intent by convention, not by proving what the user wanted.

## Proof commands

```sh
npm run test:e2e:offline # Real installed Pi + fixture injected through its fetch option
npm run test:e2e         # Real installed Pi + local HTTP/SSE fixture
npm run test:live        # Real installed Pi + configured llama.cpp endpoint
```

Each proof declares only `bash`. A test-only Pi `tool_call` handler permits exactly `printf pi_adapter_ok` once and blocks other calls. The scripts check one execution, its actual result, and (for fixtures) the second model request containing the tool result and matching ID. They use an isolated `.pi-test/agent-*` configuration directory and save JSON event evidence there. They neither disable Pi permission hooks nor install global configuration. The standalone setting is inherited, so prefix the live command with `PI_LLAMACPP_STANDALONE=1` when needed.

The offline fixture uses the same provider registration and Pi OpenAI request/SSE conversion; it replaces only network transport. The HTTP fixture additionally exercises sockets. The live proof alone verifies interaction with your loaded Qwen model and chat template. Pi's `--offline` flag in these scripts suppresses startup discovery network calls; it does not prevent model requests.

See [architecture and API inspection](docs/architecture.md) and [verification evidence](docs/verification.md).
