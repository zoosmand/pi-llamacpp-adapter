import { randomUUID } from 'node:crypto';
import { compile } from '@earendil-works/pi-schema';
import { formats } from '@earendil-works/pi-schema/formats';
import type { AssistantMessage, Tool, ToolCall } from '@earendil-works/pi-ai';

export interface NormalizeOptions { allowStandalone?: boolean; allowEmbedded?: boolean }
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Strict single-envelope validator, shared by whole-response and embedded recovery. */
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

/** Find outer JSON objects, respecting strings/escapes. Never descend into JSON data. */
export function parseEmbeddedCall(text: string, tools: Tool[]): ToolCall | undefined {
  // A complete data object/array/string remains data unless it is itself a tool envelope.
  try {
    JSON.parse(text.trim());
    return parseCall(text, tools, { allowStandalone: true });
  } catch { /* Prose or markup can contain complete tool-call objects. */ }
  const calls: ToolCall[] = [];
  const stack: string[] = [];
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (stack.length === 0) {
      if (character === '{' || character === '[') { start = index; stack.push(character); }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      if (stack.pop() !== (character === '}' ? '{' : '[')) return;
      if (stack.length === 0) {
        const candidate = text.slice(start, index + 1);
        let value: unknown;
        try { value = JSON.parse(candidate); } catch {
          if (text[start] === '[') continue; // A Markdown link label is not a JSON envelope.
          return;
        }
        if (record(value) && Object.hasOwn(value, 'name') && Object.hasOwn(value, 'arguments')) {
          const call = parseCall(candidate, tools, { allowStandalone: true });
          if (!call) return; // Do not partially accept a batch containing invalid tool envelopes.
          calls.push(call);
        }
      }
    }
  }
  if (stack.length !== 0 || quoted) return;
  // One dispatch per model turn avoids racing dependent actions such as write -> bash.
  // Pi returns the result to the model before it decides the next action.
  return calls[0];
}

export function normalizeMessage(message: AssistantMessage, tools: Tool[], options: NormalizeOptions = {}): AssistantMessage {
  // Never act on partial/error output or mix recovered calls with native tool calls.
  if (message.stopReason !== 'stop' || message.content.some(block => block.type !== 'text')) return message;
  const text = message.content.map(block => block.type === 'text' ? block.text : '').join('');
  const call = parseCall(text, tools, options) ?? (options.allowEmbedded ? parseEmbeddedCall(text, tools) : undefined);
  return call ? { ...message, content: [call], stopReason: 'toolUse' } : message;
}
