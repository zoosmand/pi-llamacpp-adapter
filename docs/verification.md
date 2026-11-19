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

## Issue #1 — `--no-skills`, 2026-11-19

Created issue #1 and an initial comment before investigating; branched `issue-1` from `dev`. No Postman skills were used for this task.

Inspected installed Pi 1.5.2 `dist/cli/args.js` and `dist/core/resource-loader.js`. The flag sets `noSkills`; extension loading remains independent. The skill loader excludes discovered skills while retaining explicitly supplied skill paths. The adapter does not depend on skill loading or change its behavior based on this flag.

Added `npm run test:skills`. It creates a synthetic skill in an isolated Pi agent directory and checks the actual serialized model instructions, with a positive control to prove the skill is discoverable. Both runs set `PI_LLAMACPP_STANDALONE=1`, recover an untagged JSON call, execute `printf pi_adapter_ok` exactly once through Pi, and replay its successful result to the fixture.

| Check | Result / ignored evidence directory |
| --- | --- |
| Standalone recovery with `--no-skills`; sentinel absent | Passed, `.pi-test/agent-ZCHLSf` |
| Standalone recovery without `--no-skills`; sentinel present | Passed, `.pi-test/agent-ZN952j` |
| Existing tagged-response Pi proof | Passed, `.pi-test/agent-P1JECf` |
| Existing unit/provider tests | All 34 passed |
| TypeScript check | Passed after restoring cached TypeScript 6.0.3 behind the existing temporary dependency link |

This confirms the user's flag combination against the installed Pi with a fixture transport; no live llama.cpp request was made. Repository workflow and the current exclusion of Postman skills are recorded in `AGENTS.md`.
