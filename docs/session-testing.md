# Single-session test — issue #2

On 2026-11-19, both the fixture and live tests passed using installed Pi 1.5.2 and the unchanged adapter.

```sh
npm run test:session       # Repeatable transport fixture
npm run test:session:live  # Configured llama.cpp endpoint
```

The harness starts one Pi RPC subprocess, sends each prompt after the preceding prompt settles, and never calls new-session, switch-session, fork, or clone. It checks the same nonempty session ID before and after each turn. Pi writes the session under an isolated `pi-llamacpp-adapter-tests/session-*/sessions/` directory in the OS temporary root. Earlier evidence paths below refer to the original issue-2 worktree, which is preserved.

The three prompts ask Pi to:

1. Remember a random token without using tools.
2. Invoke `bash` exactly once with `printf pi_adapter_ok`, then report the result.
3. Return ordinary JSON containing the remembered token and command output, without repeating either value in the prompt or invoking another tool.

Checks cover three retained user messages, exactly one bash call with the expected arguments, a successful tool result with matching call ID, correct recall in final JSON, and final content remaining text. The fixture additionally checks the serialized request history and four model requests, including the tool-result round trip. It emits the call as standalone JSON fragmented across SSE events.

Both modes keep skills disabled and standalone recovery enabled. The test-only Pi `tool_call` guard permits only `printf pi_adapter_ok`, once; command execution stays under Pi's control. No Postman skills or production configuration changes are involved.

## Live evidence

- Endpoint: `http://172.18.10.6:8080/v1`
- Model: `Qwen2.5-Coder-32B-Instruct-Q4_K_M`
- Session ID: `01a1f27c-7649-72ae-9743-44764ee8d220`
- Evidence directory: `.pi-test/session-RMDw2x/`
- Turn 1: `Remembered.`
- Turn 2: reported `pi_adapter_ok` after the real Pi bash invocation.
- Turn 3: valid JSON with the exact remembered random token and `bash_output: "pi_adapter_ok"`.

The live result verifies the real Pi/adapter/Qwen conversation and tool-result replay. Raw upstream tool-call formatting is not captured by the live harness, so it does not establish whether this live invocation used text recovery or native tool calls. The fixture specifically verifies standalone text recovery.

Fixture evidence is in `.pi-test/session-NeNnY3/`. Both directories contain events and a summary; the fixture also records requests. These are synthetic test artifacts and are ignored by Git. The harness reports fresh evidence paths on subsequent runs. It fails on provider errors, aborted/truncated responses, session changes, unexpected tool calls, missing history, or incorrect final JSON. Live generation is nondeterministic, so an assertion failure requires inspecting that run rather than assuming a session bug.

The live check required network access outside the sandbox. The server model listing confirmed the 32B model was already loaded; the test did not change server configuration.
