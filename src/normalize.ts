import { randomUUID } from 'node:crypto';
import { compile } from '@earendil-works/pi-schema';
import { formats } from '@earendil-works/pi-schema/formats';
import type { AssistantMessage, Tool, ToolCall } from '@earendil-works/pi-ai';

export interface NormalizeOptions { allowStandalone?: boolean }
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Only a whole response is eligible. Never scan prose, fences, or nested examples. */
export function parseCall(text: string, tools: Tool[], options: NormalizeOptions = {}): ToolCall | undefined {
  const trimmed = text.trim();
  const tagged = /^<(tool_call|tools|function-call)>\s*([\s\S]*?)\s*<\/\1>$/.exec(trimmed);
  if (!tagged && !options.allowStandalone) return;
  try {
    const value: unknown = JSON.parse(tagged ? tagged[2] : trimmed);
    if (!record(value) || Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, 'name') || !Object.hasOwn(value, 'arguments') ||
        typeof value.name !== 'string' || !record(value.arguments)) return;
    const matches = tools.filter(tool => tool.name === value.name);
    if (matches.length !== 1) return;
    const schema = matches[0].parameters;
    // Close top-level object arguments even if the tool omits additionalProperties.
    // Nested schemas keep their declared semantics (e.g. dictionary parameters).
    const strictSchema = { ...schema, additionalProperties: false };
    if (!compile(strictSchema, { formats }).check(value.arguments)) return;
    return { type: 'toolCall', id: `adapter_${randomUUID()}`, name: value.name, arguments: value.arguments as ToolCall['arguments'] };
  } catch {
    return; // Malformed, unsupported, or unvalidated input remains text, byte for byte.
  }
}

export function normalizeMessage(message: AssistantMessage, tools: Tool[], options: NormalizeOptions = {}): AssistantMessage {
  // Never act on partial/error output or mix recovered calls with native tool calls.
  if (message.stopReason !== 'stop' || message.content.some(block => block.type !== 'text')) return message;
  const text = message.content.map(block => block.type === 'text' ? block.text : '').join('');
  const call = parseCall(text, tools, options);
  return call ? { ...message, content: [call], stopReason: 'toolUse' } : message;
}
