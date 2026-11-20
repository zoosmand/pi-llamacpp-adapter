# Qwen and glab — issue #3

**Current recovery behavior:** [trusted tool-envelope recovery](tool-recovery.md) now recognizes calls in prose and fences. Whole-response-only and non-execution statements in the historical iterations below describe earlier versions, not the current default. Trust and permissions come from Pi.

The adapter now supplies provider-scoped tool-use and GitLab workflow instructions. They are attached to the provider request's system prompt after existing Pi sections, and work with `--no-skills`. No Postman skill or separate glab tool is installed.

The model is told to invoke one declared tool at a time, wait for its result, use `bash` to run `glab`, discover the real Git remote, select self-hosted projects explicitly, inspect CLI help on uncertainty, and distinguish authentication failures from missing resources. Issue contents and command output are treated as data. Mutations, commits, pushes, and merges require the authorization established by the user and repository instructions. These are model instructions, not a security boundary: Pi tools and permission extensions remain responsible for enforcement.

Set `PI_LLAMACPP_GUIDANCE=0` to disable the additional instructions. They do not mutate the original transcript or enabled tool set. GitLab guidance is omitted when `bash` is not declared; no guidance is added when no tools are declared. Sampling is unchanged when formatting retry is disabled.

## Optional single formatting retry

`PI_LLAMACPP_FORMAT_RETRY=1` enables at most one additional provider request per malformed tool response. It is disabled by default. This is useful for observed Qwen responses such as `bash: {"command":"git remote -v"}` or two identical tool-call objects separated by blank lines.

Recognition is deliberately narrow: the candidate must validate against exactly one active tool schema, contain no prose/fences, and be either a named argument object or two to four identical complete calls separated by blank lines. Unknown tools, invalid arguments, different proposed actions, arbitrary prose with embedded JSON, and truncated responses do not trigger this retry. Recognizing a candidate does not execute it.

The correction asks Qwen to emit the same call once in the existing canonical format. Only one final strict/native call with the same tool name and structurally identical arguments is accepted. A changed command, extra calls, malformed output, or truncated repair is rejected and the original text remains visible. Provider errors and cancellation remain terminal. Token usage and cost include both requests, even if the repair is rejected. With formatting retry enabled, both initial and correction requests default to temperature zero for more stable tool syntax; an explicit Pi temperature is honored. With the retry disabled, sampling is unchanged. The synthetic correction stays within that provider call and is not appended to Pi's persisted conversation.

This does not scan prose for executable JSON or silently execute the first proposed action. Enabling recovery still establishes a convention: call-shaped output may represent data rather than intended action. Leave the retry disabled when requesting literal examples of named calls or repeated call objects. Ordinary prose/JSON outside those narrow shapes remains unchanged.

## Start Pi

The combined code is in the `pi-llamacpp-adapter-bunch-1_2_3_4` review worktree. To operate the candidate repository while using this extension:

```sh
cd /Users/zoosman/dev/CMBC/llama/loopback
PI_LLAMACPP_STANDALONE=1 PI_LLAMACPP_FORMAT_RETRY=1 pi \
  -e /Users/zoosman/dev/CMBC/llama/pi-llamacpp-adapter-bunch-1_2_3_4/src/extension.ts \
  --no-skills --provider llamacpp-adapter \
  --model Qwen2.5-Coder-32B-Instruct-Q4_K_M
```

Example prompt:

> Read the issue #6. Tell whether you understand the task.

`glab` must already be installed and authenticated for the target host on the machine running Pi. Its credentials are resolved by glab, not the adapter. The adapter does not read credentials, start login, execute commands, or grant permissions. The extension path is absolute because Pi's working directory is the application repository, not the adapter checkout.

## Verification

```sh
npm run build
npm test
npm run test:e2e:offline
npm run test:glab:live
```

The live proof is intentionally scoped to `loopback` issue #6. It starts one Pi RPC process in `../loopback` (override the local checkout path with `PI_GLAB_PROOF_REPO`) with skills/context/MCP disabled and the normal read, bash, edit, and write tools declared. A test-only Pi handler blocks all non-bash calls and permits a fixed set of read-only remote/help/auth/issue-view commands and blocks other actions. It verifies actual successful tool output, explicit repository selection, unchanged session identity, a correct follow-up answer from retained history, and unchanged Git status. It does not test GitLab mutations or give the ordinary interactive session the test allowlist.

New synthetic test evidence is stored under `pi-llamacpp-adapter-tests/glab-*` in the OS temporary root; older `.pi-test` paths below refer to the original issue-3 worktree. `events.jsonl` records Pi events, `upstream.jsonl` captures parsed model events for diagnosing tool formatting, and successful runs write `summary.json`. This logging exists only in the proof extension; normal adapter usage does not log these payloads. Do not reuse the proof logger with sensitive prompts.

On 2026-11-19 the live proof passed against the loaded `Qwen2.5-Coder-32B-Instruct-Q4_K_M` model at `http://172.18.10.6:8080/v1`. Initial implementation evidence: `.pi-test/glab-yGnneV/`, session `01a1f418-4ccb-76d1-8a15-8f5ca1d69f29`. An earlier equivalent stable-sampling run also passed in `.pi-test/glab-8y8gm4/`. Qwen executed `git remote -v`, then the explicit `glab issue view 6 ... --comments`, accurately summarized the API-generated session key, request header, GUI control, SQLite persistence, and unspecified details. The captured upstream events show two identical proposed issue-view calls, followed by one corrected call after the bounded retry; Pi executed the issue read only once. A second prompt was answered from the same session without additional commands. Earlier probes failed on a named call, duplicate proposed calls, and prose mixed with a proposed call at server-default sampling; these are preserved under separate evidence directories and are not passing results.

TypeScript checking, all 50 unit/provider tests, the existing Pi fixture proof, and the final live read proof pass.

This establishes the exercised read workflow, not guaranteed tool adherence or all glab operations. Live generation can vary. The parser's existing whole-response contract remains unchanged; the extra provider round trip is opt-in. No production llama.cpp configuration, model weights, loopback files, or GitLab resources were changed by the proof. Adapter work is collected in the consolidated PR branch.

## Follow-up: literal placeholder selector and task drift

A user run copied the documentation selector literally, received a 404, concluded that issue #6 did not exist, then proposed unrelated branch inspection after discovering the remote. The previous live prompt explicitly requested remote discovery and therefore did not cover this short-prompt failure.

Removed executable documentation placeholders from provider guidance, including the fake tool-name example. The issue-read sequence now explicitly requires observing the remote, deriving the real selector, immediately reading the requested issue and comments, and then answering. It instructs Qwen not to list branches or stop with a proposed action, and not to infer nonexistence from a 404 without checking selector and authentication.

The live proof now uses the user's exact prompt: `Read the issue #6. Tell whether you understand the task.` It does not name the host/project or instruct remote discovery. The final proof declares the normal read/bash/edit/write tools while the test guard permits only read-only bash commands, so broad tool availability cannot authorize a write.

Both tests passed:

- `.pi-test/glab-QHUs4c/`: exact short prompt, bash-only tool declaration.
- `.pi-test/glab-kF5WVJ/`: exact short prompt, normal four tools declared.

In each run Qwen executed `git remote -v` first, then the correct `glab issue view 6 --repo gitlab.intraclear.com/infra/loopback --comments`, received the real issue, and answered both the initial question and a follow-up in the same session. No placeholder command, branch inspection, write, or failed tool execution occurred. TypeScript, all 50 tests, and the existing Pi fixture proof pass. These changes are included in the consolidated PR branch.

Restart Pi after changing the extension so the process loads the updated instructions. Earlier conversation history containing wrong commands can also bias subsequent output; these proofs use fresh sessions. This remains measured behavior for the exercised prompts, not a guarantee of adherence for every Qwen response.

## Follow-up: narrated comment preparation

A user response showed a fenced write call and a fenced comment command under two headings, rather than actual tool invocations. The parser continues to preserve that response as text. Installed `glab 1.131.0` help confirms that `issue comment` aliases `issue note`, and either reads redirected stdin when `--message` is omitted. The proposed input redirection was valid; the missing execution was the problem.

Added comment-workflow guidance when both bash and write are declared: actually invoke write, wait for success, then invoke the authorized posting command and wait for its result. It distinguishes a draft-only request from permission to post and does not claim a successful local write proves a posted comment. It recommends real temporary files, JSON-escaped newlines, and checking installed CLI help rather than inventing file flags.

Run the optional preparation proof with:

```sh
npm run test:glab:live -- --prepare-comment
```

This adds a third prompt to the same live session asking Qwen to prepare an exact multiline draft but not post it. The Pi proof guard permits one write only to that run's artifact path with exact expected content; posting and other mutations remain blocked. The proof checks the real write event and reads the resulting file to verify exact content, including newlines. This mode does not establish that an authorized live comment POST succeeds.

The live preparation proof passed in `.pi-test/glab-4RSa1x/`: remote discovery, actual issue read, retained-history answer, and one real draft write. No loopback issue comment was posted, and no loopback files were changed. The content is synthetic test text, stored only under the adapter's ignored evidence directory.

TypeScript and all 52 tests pass, including regression coverage for exact multiline write recovery and preservation of narrated multi-tool plans. These changes are included in the consolidated PR branch. Restart Pi to load updated extension instructions.

Current session-temporary-file integration: [per-session artifact paths](session-temp.md). New evidence is written under the OS temporary root, not `.pi-test`; earlier paths above are historical evidence in the original issue-3 worktree.
