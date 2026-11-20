# Per-session temporary files — issue #4

Each Pi session gets a private directory under the operating system's temporary root:

`os.tmpdir()/pi-llamacpp-adapter/sessions/session-<Pi session ID>`

The adapter creates/reuses it from the actual session ID at session startup and before each agent run. It publishes the canonical absolute path as `PI_SESSION_TMPDIR` inside the Pi process, adds it to the Qwen system instructions, and announces it in interactive Pi. No skill or global Pi configuration is required.

## Address the files

- Run `/session-temp` inside Pi to display the full current path without a model request.
- In Pi's bash tool, refer to `"$PI_SESSION_TMPDIR"`. For example, `mktemp "$PI_SESSION_TMPDIR/comment.XXXXXX"` creates a unique file there.
- For Pi's `write`/`read` tools, use the absolute path shown by `/session-temp`; those tools do not expand shell variables.
- Copy the printed path into your own terminal to inspect files. The environment variable is local to Pi and its child tools, not exported back into your parent shell.

Qwen is instructed to put temporary comment drafts, request bodies, scratch outputs, and helper scripts in that directory and to report their full paths. An explicit user destination still takes precedence. Application source changes continue to use their requested project paths. The working directory stays at the repository so Git/glab commands keep the right context. This is a default artifact-location policy communicated to the model; it does not rewrite arbitrary shell commands or replace Pi's filesystem permissions.

## Session lifetime

A new session ID receives a different directory. Switching back or resuming the same session on the same temporary root reuses the old directory. Files are retained on shutdown; no automatic deletion is performed by the adapter. Normal operating-system cleanup can remove temporary storage, so copy anything requiring archival retention elsewhere.

Directory names are derived safely from session IDs; unsafe identifiers use a hash and cannot escape the root. New directories use mode 0700. Before reusing the application root, sessions root, or an individual session directory, the adapter rejects symlinks, wrong ownership (on POSIX), and group/other permissions. It never silently chmods or takes ownership of an unsafe existing directory. Proof-evidence roots use the same checks. The adapter does not overwrite source files or migrate/delete existing draft files when enabled.

## Run and review

The isolated feature is in `issue-4`. The consolidated review branch, including issues #1–#4, is `bunch-1_2_3_4`:

```sh
cd /Users/zoosman/dev/CMBC/llama/loopback
PI_LLAMACPP_GLAB_GUIDANCE=1 PI_LLAMACPP_STANDALONE=1 PI_LLAMACPP_FORMAT_RETRY=1 pi \
  -e /Users/zoosman/dev/CMBC/llama/pi-llamacpp-adapter-bunch-1_2_3_4/src/extension.ts \
  --no-skills --provider llamacpp-adapter \
  --model Qwen2.5-Coder-32B-Instruct-Q4_K_M
```

Start a new Pi process to load the new extension. The consolidated PR targets `dev`; the original issue-2 and issue-3 worktrees and their uncommitted changes are preserved.

## Verification

```sh
npm run build
npm test
npm run test:session-temp
npm run test:session-temp:live
```

The deterministic proof uses the installed Pi CLI, actual bash environment lookup, real draft writes, `/session-temp`, new-session and switch-session RPC operations, and artifact reads after shutdown. It checks that two sessions use different directories outside the repository and that resuming the first restores its directory and files. The model fixture verifies the real directory appears in serialized system instructions.

The live mode uses Qwen and requests a temporary draft without providing a destination path. A test-only Pi guard permits only printing the session path and writing the supplied exact text within that directory. No GitLab resources can be changed by this proof.

All proof evidence now defaults to `os.tmpdir()/pi-llamacpp-adapter-tests/`, with the full paths printed by each run. Older `.pi-test` evidence is left at its original location for inspection. Existing user files, including the reported `loopback/issue_comment_6.txt`, are not moved or removed.

### Results — 2026-11-19

- Isolated issue-4 TypeScript and all 36 tests passed.
- Combined bunch-3_4 TypeScript and all 75 tests passed.
- Deterministic Pi proof passed: outside-repo drafts, bash environment, `/session-temp`, two-session isolation, resume, and files retained after shutdown.
- Live Qwen proof passed with no destination path supplied in the draft prompt. Evidence: `os.tmpdir()/pi-llamacpp-adapter-tests/session-temp-9pyuLw/`. Qwen selected `issue_comment_draft.txt` inside each actual session directory, and resume recovered the first directory and file.
- An initial live run selected the correct location but omitted a terminal newline required by the exact-content test guard. The final test body omits that ambiguous terminal newline; the guard still requires exact content and a destination inside the session directory.
- Existing trusted/untrusted execution proof and the original Pi printf fixture proof passed in the combined checkout, with evidence outside the repo.
- No GitLab comment was posted. Existing user temporary files and the issue-2/issue-3 worktrees were preserved. Work is collected in the consolidated PR branch.
