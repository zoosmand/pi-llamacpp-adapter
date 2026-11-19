# Verification — 2026-11-16

Environment: macOS, Node 24.16.0, installed Pi 1.5.2. The workspace was initially empty. Runtime packages were linked from the installed Pi; TypeScript 6.0.3 was extracted from the existing npm cache into a temporary directory for the type check. No registry installation succeeded in the restricted environment. For a portable fresh checkout, use `npm install` as documented; the project manifest pins the Pi runtime dependencies.

| Check | Result | What it establishes |
| --- | --- | --- |
| `npm run build` | Passed | Strict TypeScript check against installed Pi definitions |
| `npm test` | 34 passed | Formats, invalid names/arguments, false positives, JSON/text preservation, usage, balanced events, request hooks, truncation, abort |
| `npm run test:e2e:offline` | Passed | Installed Pi executed exactly one real bash invocation after recovery from fragmented assistant content; matching tool result was sent back to the fixture |
| `pi … --list-models llamacpp` with extension | Passed | Registration visible to installed Pi startup/model selection |
| `npm run test:e2e` | Blocked: `listen EPERM 127.0.0.1` | Sandbox prohibits local listening sockets; no HTTP fixture success claimed |
| `npm run test:live` | Blocked: `connect EPERM 172.18.10.6:8080` | Sandbox prohibits connection; production Qwen/chat-template behavior remains unverified |

Successful post-restart Pi evidence is under `.pi-test/agent-yl2JGe/`:

- `events.jsonl`: actual Pi lifecycle/tool execution events.
- `requests.jsonl`: two fixture requests, including replayed tool call and result.
- `stderr.txt`: Pi stderr.

These ignored artifacts are from a synthetic prompt and fixture. The adapter itself does not log prompts, credentials, or provider responses. Earlier `.pi-test` directories include failed setup attempts; they are not passing evidence.

The transport fixture intercepts only a reserved `.invalid` URL through Pi's explicit `fetch` option. It runs the real installed Pi CLI, production extension registration, OpenAI serialization, SSE parser, normalizer, Pi bash dispatch, and tool-result replay. It does not test TCP networking or the actual Qwen model. The proof uses a test-only Pi policy that permits the single harmless command and blocks everything else.

API Engineering and API Simulation skill guidance informed boundary checks and separation of fixture/live evidence. No Postman workspace, deployment, or shared resource was needed for this minimal extension. Installed Postman CLI 1.73.0 returned `unknown command 'status'`; no successful Postman status or simulation is claimed. Socket restrictions prevented a local network simulation; the transport fixture is the documented fallback.

Run `npm run test:live` outside the sandbox on a host able to reach the endpoint. If Qwen emits standalone JSON, use `PI_LLAMACPP_STANDALONE=1 npm run test:live`. A successful fixture proof alone does not establish that task's live verification requirement.
