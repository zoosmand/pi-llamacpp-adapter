# Architecture and installed API inspection

Inspected the locally installed `@earendil-works/pi-coding-agent` version 1.5.2, its bundled `@earendil-works/pi-ai` and `pi-schema` 1.5.2, installed documentation, TypeScript declarations, and implementation. The installed package root is obtained with `npm root -g`, then `@earendil-works/pi-coding-agent`.

Relevant installed sources:

- `docs/custom-provider.md`, `docs/extensions.md`, `docs/models-configuration.md`
- `schemas/models.schema.json` (JSON Schema draft 2020-12)
- `dist/core/extensions/types.d.ts` (provider registration)
- `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.{js,d.ts}`
- `node_modules/@earendil-works/pi-ai/dist/utils/{transcript,validation,event-stream}.{js,d.ts}`
- `node_modules/@earendil-works/pi-schema/dist/validator.d.ts`

The [upstream custom-provider guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md) also documents provider registration and reuse of Pi's API implementations. Local installed definitions are the implementation target; older Pi distributions under other package names are not assumed compatible.

## Interception options

`models.json` configures providers, endpoint/authentication, models, limits, and API compatibility fields. It has no executable response-normalization callback. Its root requires `providers`; each custom provider needs endpoint/API selection. Models require IDs and may supply names, capabilities, cost, limits, and per-model compatibility. `compat` flags adjust known protocol differences; none rewrites arbitrary assistant content into tool calls.

Pi 1.5.2 also supports a `message_end` extension handler returning `{ message }` with the same role. That is a supported finalized-message replacement mechanism. `before_provider_request` replaces request payloads; `after_provider_response` exposes status/headers; `provider_stream_event` observes parsed upstream events. Request/header hooks cannot themselves solve text-to-tool-call conversion.

This proof uses `pi.registerProvider(name, config)` with `streamSimple`, the documented configuration registration form. It keeps recovery scoped to a separate selectable provider and emits consistent tool-call events as well as a final tool-call message. The newer complete `Provider` object is also supported; the smaller configuration form suffices for a fixed local model without discovery or custom authentication.

## Data flow

```text
Pi agent and active tool declarations
  -> adapter streamSimple
  -> Pi AI OpenAI Completions streamSimple
  -> llama.cpp /v1/chat/completions (SSE)
  -> buffered final AssistantMessage
  -> Pi trust snapshot + whole-response recovery (embedded is opt-in) + strict schema check
  -> balanced Pi text/tool-call events + final AssistantMessage
  -> Pi tool dispatch and permission hooks
  -> Pi tool result -> next OpenAI request through Pi's converter
```

The extension directly calls the underlying OpenAI implementation, avoiding recursive provider dispatch. It reuses request conversion, history replay, SSE parsing, instrumentation hooks, cancellation, usage and cost accounting. `getCurrentTools(context.messages)` resolves Pi 1.5.2's transcript tool declarations, including subsequent additions/removals; older `context.tools` assumptions would be incorrect.

Pi's usual argument validator performs coercion. Recovered calls instead use `pi-schema.compile(...).check(...)` with formats and without coercion. Schema compilation failure rejects recovery. A fresh adapter ID is created for each recovered call. Incoming native tool calls retain Pi's normal validation and dispatch path; the adapter's extra execution-time trust gate checks only recovered adapter_ IDs, not ordinary native calls.

Buffering is deliberate: partial tags or JSON must never trigger tool execution. It delays visible output until the response completes. The adapter dispatches one validated recovered call per response. In trusted projects it recognizes complete tagged responses and explicitly enabled whole-response JSON. Extraction from prose/code fences requires PI_LLAMACPP_EMBEDDED=1. An outer-object scanner respects JSON strings and escapes and does not descend into complete JSON data documents. Multiple proposals are validated before dispatching the first; the next action is reconsidered after Pi returns its result. An optional single formatting retry remains for narrowly recognized legacy forms. See [the current recovery contract](tool-recovery.md). The adapter does not rewrite the server chat template.

`models.json` is unnecessary for this extension. If desired, static overrides for its existing model can use the installed schema, for example:

```json
{
  "$schema": "https://pi.dev/schemas/models.schema.json",
  "providers": {
    "llamacpp-adapter": {
      "modelOverrides": {
        "Qwen2.5-Coder-32B-Instruct-Q4_K_M": {
          "contextWindow": 32768,
          "maxTokens": 4096
        }
      }
    }
  }
}
```

Trust is observed through session/before-agent-start contexts using `ctx.isProjectTrusted()` and rechecked by a `tool_call` hook at execution. The adapter does not register a trust-approval handler or maintain a separate trust database. The response logic always comes from the loaded extension. No global Pi files or production llama.cpp configuration are changed by this project.
