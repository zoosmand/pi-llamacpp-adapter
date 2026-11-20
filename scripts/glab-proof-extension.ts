/** Test-only command/draft allowlist and upstream evidence; never loaded by normal adapter usage. */
import { appendFileSync } from 'node:fs';
import type { ExtensionAPI, ProviderConfig } from '@earendil-works/pi-coding-agent';
import extension from '../src/extension.ts';

const allowed = new Set([
  'pwd', 'git remote -v', 'pwd && git remote -v',
  'glab issue view 6 --repo gitlab.intraclear.com/infra/loopback --comments',
  'glab issue view 6 --comments --repo gitlab.intraclear.com/infra/loopback',
  'glab issue view --repo gitlab.intraclear.com/infra/loopback 6 --comments',
  'glab issue view 6 --repo gitlab.intraclear.com/infra/loopback',
  'glab issue view 6 --repo gitlab.intraclear.com/infra/loopback --comments --output json',
  'glab issue view --help', 'glab issue note --help', 'glab issue comment --help', 'glab --help',
  'glab auth status --hostname gitlab.intraclear.com',
]);
export default function glabProofExtension(pi: ExtensionAPI) {
  let count = 0;
  let wroteDraft = false;
  pi.on('tool_call', event => {
    count++;
    if (event.toolName === 'write' && !wroteDraft && count <= 12 && process.env.PI_GLAB_PROOF_COMMENT &&
        event.input.path === process.env.PI_GLAB_PROOF_COMMENT && event.input.content === process.env.PI_GLAB_PROOF_COMMENT_TEXT) {
      wroteDraft = true;
      return;
    }
    if (event.toolName !== 'bash' || typeof event.input.command !== 'string' ||
        !allowed.has(event.input.command.trim()) || count > 12) {
      return { block: true, reason: 'Proof permits only remote/help/issue reads and, when configured, one exact draft-file write. Posting is blocked.' };
    }
  });
  extension({ on: pi.on.bind(pi), registerCommand: pi.registerCommand.bind(pi), registerProvider(name: string, config: ProviderConfig) {
    pi.registerProvider(name, { ...config,
      streamSimple: (model, context, options) => config.streamSimple!(model, context, { ...options,
        onProviderStreamEvent: async (event, upstreamModel) => {
          if (process.env.PI_GLAB_PROOF_UPSTREAM) appendFileSync(process.env.PI_GLAB_PROOF_UPSTREAM, JSON.stringify(event) + '\n');
          await options?.onProviderStreamEvent?.(event, upstreamModel);
        },
      }),
    });
  } } as ExtensionAPI);
}
