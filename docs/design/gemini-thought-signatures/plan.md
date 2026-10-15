# Plan

## Baseline

Build the PR on `origin/release/v0.122.6` at commit
`090e8bd81b89548cdc0b8404e4ebe521bf0cf887` ("Merge pull request #7558"), the newest open
release branch on 2026-10-14, and target that branch. If a newer release branch opens before the
work starts, rebase on it. The local GitButler workspace is older than this branch and has
neither the skip value nor the runner extension, so do not build from it.

## Steps

1. **Request path.** In `static_fields.py`, add `THOUGHT_SIGNATURE_SEPARATOR` and
   `_restore_thought_signatures`, and delete `GEMINI_SKIP_THOUGHT_SIGNATURE` and
   `_fill_thought_signatures`. Update the two static-field tests.
2. **Response path.** Add `sign_tool_call_ids` and `is_gemini_chat` to `static_fields.py`.
   Add the `sign` flag to `_StreamUsageReader`, compute it in `relay_chat_completion`, and
   pass it to `_stream_body` and `_single_chunk_body`. Update the docstrings and the D34 test
   comment. Add the `sign_tool_call_ids` test and the split-frame relay test.
3. **Channel cap.** Remove `max_length=200` from `ChannelMessageSendRequest.tool_call_id`.
4. **Runner.** Delete the extension, its registration, its unit test, the pi-loop test block
   and the two test helper options, and restore the `extension-tools.test.ts` assertion, as
   listed in [design.md](design.md).
5. **Format and test.** In `api/`, run `ruff format` and `ruff check --fix` with the system
   ruff, then the gateway unit tests. In `services/runner`, run the unit tests and the
   in-process integration tests.

## Live check

On a local stack with the Vertex service account or a working `gemini` provider key:

1. Run a Pi agent on a Gemini 3 model with a task that needs a parallel step and then a
   sequential step. The turn completes.
2. In the gateway's outbound requests, every first call of a step carries its real signature
   in `extra_content`, no request carries `skip_thought_signature_validator`, and Google
   receives ids with no `__thought__` suffix on both calls and tool results.
3. Restart the runner between two turns of the same session, then send a turn that makes a
   tool call. It succeeds without the extension.
4. Switch the session to an OpenAI or Anthropic model and send one more message. It succeeds.
5. On a channel-connected Gemini agent, post with `send_channel_message`. The post succeeds.

## Evidence

`~/agenta-gemini-thought-signatures-evidence/capture.py` reruns the wire capture:
`uv run capture.py <staging env json> google/gemini-3.7-flash <out dir> vertex`.
