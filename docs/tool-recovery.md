# Tool recovery and Pi trust

A tool envelope with a declared `name` and schema-valid `arguments` is an instruction to execute through Pi when Pi considers the project trusted. This includes an envelope wrapped in explanatory prose or Markdown fences. The adapter now handles that normalization directly rather than requiring Qwen to produce a whole-response envelope perfectly or relying only on stronger prompts.

## Recognition

The provider buffers the completed assistant response, checks Pi trust, and validates candidate envelopes against active transcript tool declarations. JSON object boundaries are scanned with string/escape tracking, so braces and escaped newlines inside command strings or file content do not split arguments. Tool names are exact and case-sensitive. No type coercion, default filling, argument stripping, or malformed JSON repair is performed.

Complete ordinary JSON documents are parsed as data. An outer object/array containing nested examples is not searched recursively. A complete object which is itself a valid tool envelope is executable in trusted mode. Unknown/ambiguous tool names, invalid arguments, incomplete JSON, and truncated/error output remain text. An invalid proposed envelope in a multi-envelope response prevents partial acceptance of that response.

Only the first validated envelope is converted per model response; prose around that executable envelope is replaced by its native tool-call block. This also deduplicates repeated proposals within a response. Remaining proposed actions are not queued or run in parallel: Pi returns the actual result to Qwen, which must then decide and emit the next action from the user request. This preserves dependencies such as write-file -> submit-file without changing Pi's global execution mode. It does not guarantee Qwen completes every later action.

## Trust and execution

`registerTrustGate()` observes `ctx.isProjectTrusted()` from session startup and before-agent-start events. The provider reads that live decision before recovery and again before finalizing its response. A `tool_call` hook rechecks Pi's current trust at execution and blocks adapter/relevant native calls if untrusted. No trust decision is granted or persisted by the adapter. Pi's API includes remembered, temporary, CLI, and default trust decisions.

The adapter does not spawn bash or glab. It emits Pi-native events with `stopReason: toolUse`. Pi executes the declared tool, applies its own hooks, and returns the result. Trust permits recovery; it does not bypass any other Pi permission handler. Direct SDK consumers of exported `streamAdapter` must supply the runtime trust reader; omission defaults to untrusted.

Embedded recovery is enabled by default in trusted projects. It does not need skills, `PI_LLAMACPP_STANDALONE`, or a formatting retry. `PI_LLAMACPP_EMBEDDED=0` restores legacy strict whole-response recognition, where bare JSON requires `PI_LLAMACPP_STANDALONE=1`. `PI_LLAMACPP_FORMAT_RETRY=1` remains optional for validated named-prefix legacy forms; it is attempted only when direct recovery found no call. A corrected call must still match the original validated name and arguments.

## Deterministic proof

```sh
npm run test:embedded
```

A fixture returns the reported response shape: a prose heading and fenced write envelope followed by another heading and fenced bash envelope. Real installed Pi is tested twice with actual per-run Pi trust flags:

- `--no-approve`: the response remains text, no tools execute, no draft or submission artifact exists.
- `--approve`: Pi writes the exact multiline draft. After its successful result, a second fenced bash proposal is executed. Bash runs a local executable simulating glab, which verifies stdin and writes a simulated-submission artifact. Tool events prove the write completed before bash started, exactly once each.

The model transport is a fixture; Pi, write, bash, stdin redirection, and file checks are real. No network, GitLab credentials, or actual issue POST is used. Passing evidence: `.pi-test/embedded-1x7s87/` (trusted and untrusted subdirectories). Every run prints its own paths.

## Live model proof

```sh
npm run test:embedded:live
```

Uses real Qwen with the same exact-action Pi guard and local simulated glab destination. The prompt supplies that local command explicitly because the test must not post to the real issue. This checks model continuation from file writing to submission; it is distinct from the real GitLab read proof:

```sh
npm run test:glab:live -- --prepare-comment
```

That proof reads the actual loopback issue, answers from retained history, and writes a local draft, while blocking all posting. Updated trust-aware adapter evidence: `.pi-test/glab-ep9YiM/`. The live-Qwen simulated submission also passed in `.pi-test/embedded-H87ySW/trusted/`: a real write followed by a real bash invocation, exact stdin verified by the local fake glab. An earlier live simulation was blocked by the test guard because Qwen omitted optional path quotes; the guard now accepts only the exact quoted/unquoted command forms for the known shell-safe artifact paths, not arbitrary command transformations. Real GitLab issue mutation remains untested and was not performed.

These changes are consolidated on `bunch-1_2_3_4` for PR review. `docs/verification.md` and earlier portions of `docs/glab.md` retain historical evidence for the earlier strict parser; this document and the README describe the current trust-aware behavior.

Final local checks: TypeScript and all 73 tests pass, including trust gating, embedded prose/fence recovery, ordinary JSON/data-array preservation, and the prior strict/format-retry tests. Deterministic trusted/untrusted submission and the original Pi fixture proof also pass.
