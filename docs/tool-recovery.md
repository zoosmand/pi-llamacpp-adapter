# Tool recovery and Pi trust

## Defaults and explicit opt-ins

Default recovery requires a complete tagged response with a declared tool name and schema-valid arguments. Whole-response bare JSON is supported with `PI_LLAMACPP_STANDALONE=1`. Prose and Markdown fences are not searched by default, so quoted examples and responses saying “do not run this” stay text. Normal text and JSON data remain unchanged.

Live re-review of Qwen2.5-Coder-32B found bare envelopes for both legitimate actions and documentation-only examples. Tagged-only defaults left the observed reads and Go-test commands as text too. `PI_LLAMACPP_STANDALONE=1` recovered the real actions, but also executed the pure-envelope example despite the user's “do not execute” instruction. These responses have the same syntactic shape; this is not something a JSON parser can distinguish. Request literal examples inside a data object rather than as bare envelopes.

`PI_LLAMACPP_EMBEDDED=1` explicitly enables extraction from prose and fences. This is broader syntactic recognition, not an intent or authorization check: a valid quoted call, including one the surrounding prose rejects, may execute. Pi project trust does not extend to GitLab issue bodies, MR comments, command output, or every example the model echoes. Use default recognition for documentation/untrusted quoted material; Pi's existing permission/confirmation handlers remain responsible for execution policy. The adapter does not add another confirmation dialog.

## Recognition and validation

The provider buffers the completed response, snapshots project trust once, and validates envelopes against active transcript tools. Exact names, unique declarations, and strict arguments are required. No coercion, defaults, stripping, or malformed-JSON repair is applied. The top-level schema is closed with additionalProperties:false; tools whose properties are declared only inside top-level allOf/anyOf branches currently fail closed and remain text rather than being flattened automatically.

Opt-in embedded scanning tracks JSON strings, escapes, and outer containers. It does not descend into complete JSON data objects or arrays. Unknown/ambiguous tools, invalid envelopes, malformed JSON, and truncated/error output are not executed. An invalid proposed envelope prevents partial acceptance of its batch.

Only the first validated proposal per response is dispatched. Duplicate proposals do not form a batch. Remaining actions are reconsidered by the model after Pi returns the actual result, avoiding write-file/submit-file races. This does not guarantee the model completes every subsequent action.

## Trust scope

`registerTrustGate()` observes Pi's `ctx.isProjectTrusted()` without granting or persisting trust. One trust snapshot governs each provider response, including a formatting repair. At actual dispatch the tool_call handler rechecks trust for recovered `adapter_` IDs, so a later revocation can still block them.

Ordinary native upstream tool_calls pass through unchanged and remain subject to Pi's standard tool/permission policy, even in an untrusted project. They are not blocked merely because the selected provider is llamacpp-adapter. A native call used as an accepted formatting correction is still a recovered action and receives an adapter_ ID so the recovery gate applies.

The adapter never launches bash/glab itself. It emits Pi-native events with toolUse and waits for Pi's normal loop. Direct SDK consumers must supply a runtime trust reader for recovery; omission defaults to untrusted.

## Optional guidance and formatting correction

General tool guidance works without skills. The larger GitLab/comment instructions are omitted unless `PI_LLAMACPP_GLAB_GUIDANCE=1` and the required tools are declared. `PI_LLAMACPP_GUIDANCE=0` disables all extra tool instructions.

`PI_LLAMACPP_FORMAT_RETRY=1` permits one additional provider request for narrowly recognized, validated named-prefix or repeated-identical calls that direct recovery did not accept. The correction must keep the same name and exact arguments. Its synthetic instruction is not persisted into Pi history. Failed/changed repairs remain text; cancellation/provider errors are terminal. Both requests contribute usage/cost.

Only the correction defaults to temperature zero. Primary sampling is unchanged, and an explicit Pi temperature is honored. Error fallback text distinguishes a failed correction from cancellation.

## Verification

```sh
npm run test:embedded
npm run test:embedded:defaults:live
npm run test:embedded:live
```

The deterministic installed-Pi proof covers three modes: untrusted with embedded enabled (no tools), trusted with embedded absent (narrated/fenced text stays text), and trusted with embedded explicitly enabled (one real write then one real bash call to a local simulated glab destination). The guard blocks other actions. No actual GitLab POST is used.

The live-defaults proof asks real Qwen for a documentation-only bash envelope and requires zero tool execution. A guard blocks the example command if a regression attempts dispatch. That negative test does not establish that Qwen emits tagged responses for legitimate actions; the re-review observed legitimate bare envelopes staying text under those defaults as well. The opt-in live proof instead exercises writing and submitting exact test content to a local simulation; it is not a real issue mutation.

Earlier implementation evidence under .pi-test belongs to the preserved issue-3 worktree and used pre-review defaults. Current proofs print paths under the validated OS temporary root. The existing real-GitLab read/draft proof remains available as `npm run test:glab:live -- --prepare-comment`; it explicitly enables GitLab guidance and blocks posting.
