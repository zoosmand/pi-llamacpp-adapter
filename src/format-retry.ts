import { isDeepStrictEqual } from 'node:util';
import type { AssistantMessage, Tool, ToolCall, TranscriptContext } from '@earendil-works/pi-ai';
import { parseCall } from './normalize.ts';

/** Recognition only, not execution: one named call or repeated identical valid calls, no prose. */
export function formattingAttempt(message: AssistantMessage, tools: Tool[]): ToolCall | undefined {
  if (message.stopReason !== 'stop' || message.content.some(block => block.type !== 'text')) return;
  const text = message.content.map(block => block.type === 'text' ? block.text : '').join('').trim();
  const named = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(\{[\s\S]*\})$/.exec(text);
  if (named) {
    try {
      return parseCall(JSON.stringify({ name: named[1], arguments: JSON.parse(named[2]) }), tools, { allowStandalone: true });
    } catch { return; }
  }
  const parts = text.split(/\n\s*\n/);
  if (parts.length < 2 || parts.length > 4) return;
  const calls = parts.map(part => parseCall(part, tools, { allowStandalone: true }));
  const first = calls[0];
  if (first && calls.every(call => call && sameCall(call, first))) return first;
}
export function sameCall(a: ToolCall, b: ToolCall): boolean {
  return a.name === b.name && isDeepStrictEqual(a.arguments, b.arguments);
}
export function formattingRetryContext(context: TranscriptContext, message: AssistantMessage): TranscriptContext {
  return { ...context, messages: [...context.messages, message, {
    role: 'user', timestamp: Date.now(),
    content: 'Formatting correction: your previous response did not execute a tool. If you intended that action, return the SAME tool name and EXACT SAME arguments once, wrapped in <tool_call> JSON </tool_call>, with no other text, then stop. Do not add or change actions. If the original request asked for examples or data, answer as ordinary text instead of invoking a tool.',
  }] };
}
/** Both provider calls consumed tokens, even when the repair cannot be accepted. */
export function combinedUsage(a: AssistantMessage['usage'], b: AssistantMessage['usage']): AssistantMessage['usage'] {
  return { ...b, input: a.input + b.input, output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite,
    ...(a.reasoning !== undefined || b.reasoning !== undefined ? { reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0) } : {}),
    ...(a.cacheWrite1h !== undefined || b.cacheWrite1h !== undefined ? { cacheWrite1h: (a.cacheWrite1h ?? 0) + (b.cacheWrite1h ?? 0) } : {}),
    totalTokens: a.totalTokens + b.totalTokens,
    cost: { ...b.cost, input: a.cost.input + b.cost.input, output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead, cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total, totalFromProvider: a.cost.totalFromProvider === true && b.cost.totalFromProvider === true },
  };
}
