// Exercise the production registration; change only the test transport via Pi's fetch option.
import extension, { streamAdapter } from '../src/extension.ts';
import { guard } from './guard.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
// @ts-expect-error Test-only JavaScript fixture has no declaration file.
import { fixtureFetch } from './offline-fixture.mjs';
export default function fixtureExtension(pi: ExtensionAPI) {
  guard(pi);
  const capture = {
    registerProvider(name: string, config: object) {
      pi.registerProvider(name, { ...config,
        streamSimple: (model, context, options) => streamAdapter(model, context, { ...options, fetch: fixtureFetch }),
      });
    },
  };
  extension(capture as ExtensionAPI);
}
