import { registerSessionTemp } from './session-temp.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage,
  type Api, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { streamSimple as openAIStream } from '@earendil-works/pi-ai/api/openai-completions';
import { registerTrustGate } from './trust.ts';
import { normalizeMessage } from './normalize.ts';
import { withToolGuidance } from './guidance.ts';
import { combinedUsage, formattingAttempt, formattingRetryContext, sameCall } from './format-retry.ts';

export interface AdapterRuntime { isProjectTrusted(): boolean }

export function streamAdapter(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions, runtime: AdapterRuntime = { isProjectTrusted: () => false }) {
  const output = createAssistantMessageEventStream();
  void (async () => {
    let message: AssistantMessage | undefined;
    try {
      // Reuse Pi's HTTP, transcript conversion, SSE, usage, cancellation, and hooks.
      if (model.api !== 'openai-completions') throw new Error('Expected openai-completions API');
      const retryEnabled = process.env.PI_LLAMACPP_FORMAT_RETRY === '1';
      const requestContext = withToolGuidance(context, process.env.PI_LLAMACPP_GUIDANCE !== '0', process.env.PI_LLAMACPP_GLAB_GUIDANCE === '1');
      const inner = openAIStream(model as Model<'openai-completions'>, requestContext, options);
      for await (const event of inner) {
        if (event.type === 'error') { output.push(event); output.end(); return; }
      }
      message = await inner.result();
      if (options?.signal?.aborted) {
        output.push({ type: 'error', reason: 'aborted', error: { ...message, stopReason: 'aborted', errorMessage: 'Aborted' } });
        output.end(); return;
      }
      // One response uses one trust snapshot; the tool_call hook rechecks at execution.
      const trusted = runtime.isProjectTrusted();
      const tools = getCurrentTools(context.messages);
      const normalizeOptions = { allowStandalone: process.env.PI_LLAMACPP_STANDALONE === '1',
        allowEmbedded: process.env.PI_LLAMACPP_EMBEDDED === '1' };
      const original = message;
      if (trusted) message = normalizeMessage(message, tools, normalizeOptions);
      const expected = trusted && message === original && retryEnabled ? formattingAttempt(message, tools) : undefined;
      if (expected) {
        const repairStream = openAIStream(model as Model<'openai-completions'>,
          formattingRetryContext(requestContext, message), { ...options, temperature: options?.temperature ?? 0 });
        for await (const _event of repairStream) { /* Buffer the single repair before exposing any tool call. */ }
        const repair = await repairStream.result();
        const usage = combinedUsage(message.usage, repair.usage);
        if (options?.signal?.aborted || repair.stopReason === 'error' || repair.stopReason === 'aborted') {
          const reason = options?.signal?.aborted ? 'aborted' : repair.stopReason as 'error' | 'aborted';
          output.push({ type: 'error', reason, error: { ...repair, usage, stopReason: reason, errorMessage: repair.errorMessage || (reason === 'aborted' ? 'Aborted' : 'Formatting repair failed') } });
          return;
        }
        const normalized = normalizeMessage(repair, tools, normalizeOptions);
        const call = normalized.content.length === 1 && normalized.content[0].type === 'toolCall' ? normalized.content[0] : undefined;
        // A formatting retry cannot authorize a different action or altered arguments.
        message = call && !call.argumentsError && normalized.stopReason === 'toolUse' && sameCall(call, expected)
          ? { ...normalized, content: [{ ...call, id: expected.id }], usage } : { ...message, usage };
      }
      message = trusted ? normalizeMessage(message, tools, normalizeOptions) : { ...original, usage: message.usage };
      const final = message;
      const partial: AssistantMessage = { ...final, content: [] };
      output.push({ type: 'start', partial });
      for (const block of final.content) {
        const contentIndex = partial.content.length;
        partial.content.push(block);
        if (block.type === 'toolCall') {
          output.push({ type: 'toolcall_start', contentIndex, partial });
          output.push({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(block.arguments), partial });
          output.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial });
        } else {
          const type = block.type;
          const content = type === 'text' ? block.text : block.thinking;
          output.push({ type: `${type}_start`, contentIndex, partial });
          output.push({ type: `${type}_delta`, contentIndex, delta: content, partial });
          output.push({ type: `${type}_end`, contentIndex, content, partial });
        }
      }
      if (final.stopReason === 'error' || final.stopReason === 'aborted') {
        output.push({ type: 'error', reason: final.stopReason, error: final });
      } else if (final.stopReason === 'pending') {
        throw new Error('Provider returned an unfinished message');
      } else output.push({ type: 'done', reason: final.stopReason, message: final });
    } catch (error) {
      const reason = options?.signal?.aborted ? 'aborted' : 'error';
      output.push({ type: 'error', reason, error: {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [], timestamp: Date.now(),
        usage: message?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: reason, errorMessage: error instanceof Error ? error.message : String(error),
      } });
    } finally { output.end(); }
  })();
  return output;
}

export default function extension(pi: ExtensionAPI) {
  registerSessionTemp(pi);
  const isProjectTrusted = registerTrustGate(pi);
  pi.registerProvider('llamacpp-adapter', {
    baseUrl: process.env.PI_LLAMACPP_BASE_URL ?? 'http://172.18.10.6:8080/v1',
    apiKey: 'local', api: 'openai-completions',
    streamSimple: (model, context, options) => streamAdapter(model, context, options, { isProjectTrusted }),
    models: [{ id: process.env.PI_LLAMACPP_MODEL ?? 'Qwen2.5-Coder-32B-Instruct-Q4_K_M',
      name: 'Local Qwen2.5 Coder (adapter)', reasoning: false, input: ['text'],
      contextWindow: 32768, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false,
        supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
    }],
  });
}
