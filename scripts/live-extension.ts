import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import extension from '../src/extension.ts';
import { guard } from './guard.ts';
export default function liveExtension(pi: ExtensionAPI) { guard(pi); extension(pi); }
