# PR #5 review corrections — 2026-11-20

The review of c1b6e8f reproduced unintended execution of a documentation example. The correction keeps normal whole-response recovery but makes broader extraction an explicit decision.

| Finding | Correction |
| --- | --- |
| Embedded extraction enabled by default | `PI_LLAMACPP_EMBEDDED=1` is now required. Quoted/fenced/rejected calls stay text with the flag absent, even in a trusted project. Tagged calls and the existing `PI_LLAMACPP_STANDALONE=1` whole-response mode remain supported. |
| Trust gate included native calls | Only recovered `adapter_` IDs are gated. Native calls use Pi's normal policy, including in untrusted projects. Accepted native formatting corrections receive a recovered ID, so they cannot bypass the recovery gate. |
| Shared temp roots were blindly reused | Application/session/evidence roots are checked with lstat, POSIX uid, and private permissions. Symlinks, foreign ownership, and group/other permissions are rejected before reuse; unsafe directories are not chmodded or adopted. |
| GitLab guidance on every bash request | `PI_LLAMACPP_GLAB_GUIDANCE=1` is now required for GitLab/comment instructions. General tool guidance remains separate; the live GitLab proof explicitly enables the GitLab flag. |
| Misleading repair error fallback | Missing error messages use “Formatting repair failed” for errors and “Aborted” for cancellation. |
| Multiple trust reads per response | Recovery uses one snapshot, while the execution hook still checks current trust before dispatch. |
| Retry changed primary sampling | Only the correction defaults to temperature zero; primary options and explicit caller temperatures are preserved. |
| Composed top-level schemas | Commented/documented that strict top-level closure fails closed when properties only exist in allOf/anyOf branches. |

## Checks

- TypeScript check and all 86 unit/provider tests pass.
- Installed-Pi fixture checks pass: skills control, three-turn session, session-temp isolation/resume/retention, original printf proof, and embedded modes.
- Embedded fixture covers untrusted opt-in (no execution), trusted default (no execution), and trusted explicit opt-in (write then bash to a local simulation).
- Live Qwen documentation-only test passed with default recovery settings: zero tool execution, and the example remained text. Evidence: `os.tmpdir()/pi-llamacpp-adapter-tests/embedded-Dkmy1B/trusted-default/`. This is a negative check, not evidence that defaults execute legitimate tasks: the later re-review observed Qwen emitting bare envelopes for real reads/tests as well, which tagged-only defaults also leave as text.
- New filesystem cases reject permissive roots, symlink roots/session directories, and a mismatched uid before creating files. The uid case uses an unprivileged mocked uid reader, not a real ownership change.

This does not make embedded mode an intent filter: explicit opt-in still allows syntactically valid examples to become actions. Pi project trust does not authorize an action or authenticate external content. No real GitLab issue write or destructive command was executed during these checks.

The re-review accepts the local code fixes once pushed and requests documentation of the bare-envelope limitation. The quick-start and recovery docs now explain that `PI_LLAMACPP_STANDALONE=1` executes a valid whole-response envelope even when requested only as an example. Literal examples should be enclosed in a data object. These notes remain as the repository's verification record; no PR reply or code push is implied by this document.
