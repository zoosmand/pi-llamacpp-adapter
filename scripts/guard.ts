import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
/** Test-scoped Pi policy: only the requested harmless proof command, once. */
export function guard(pi: ExtensionAPI) {
  let used = false;
  pi.on('tool_call', event => {
    if (used || event.toolName !== 'bash' || event.input.command !== 'printf pi_adapter_ok') {
      return { block: true, reason: 'Proof permits only printf pi_adapter_ok, once' };
    }
    used = true;
  });
}
