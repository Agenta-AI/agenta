# Context

## What happens today

Gemini 3 returns a thought signature with the first tool call of each model step, at
`tool_calls[i].extra_content.google.thought_signature`. On the next request it wants the same
signature on the same tool call in the history. If a call in the current turn comes back
without it, Google answers HTTP 400.

Pi's OpenAI client drops `extra_content`. Two pieces of code cover for that today, in two
layers:

- **The runner.** A Pi extension, `services/runner/src/extensions/gemini-thought-signatures.ts`
  (released in v0.122.5), reads each signature from Pi's raw stream, stores it on the tool
  call, and puts it back on the next request. It is live in production EU (image
  `d6eb5047`, Pi 0.99.1) on the in-process Pi path, and the gateway relays the stream it
  reads unchanged.
- **The gateway.** `_fill_thought_signatures` in
  `api/oss/src/core/gateways/llms/providers/passthrough/static_fields.py` writes Google's
  skip value into every assistant tool call that has no signature. With the extension
  working, the skip value most likely lands only on the second and later calls of a parallel
  step. Gemini never signs those calls and does not check them, so there the skip value does
  nothing.

So signatures most likely round-trip correctly today. The production session that ended in
`malformed_function_call` on 2026-10-13 (`65a8da03`, `google/gemini-3.7-flash`) is probably
not explained by lost signatures, and this change is not expected to fix it.

## Why we change it anyway

Signatures are a property of one provider's wire format, and the gateway is the layer that
owns provider wire formats. Keeping them in a Pi extension has these costs:

- Only Pi gets signatures. Any other client of the gateway would still hit HTTP 400 or rely
  on the skip value.
- The extension depends on Pi's internal hooks and message shapes, so a Pi upgrade can break
  it.
- Two layers each do half of the job: the runner restores real signatures, and the gateway
  fills the rest with a value Google says lowers quality.

The change moves the job to the gateway, the way LiteLLM does it: the gateway appends each
signature to its tool call id in the response, and restores it from the id on the next
request. It deletes the skip value and the runner extension in the same PR.

## Goals

- The gateway alone gives Gemini its signatures back, for every client that keeps tool call
  ids.
- No skip value and no runner code for signatures.
- Non-Gemini routes see no change, byte for byte, except that a request whose tool call
  ids carry a `__thought__` suffix loses the suffix.
- Fewer lines than today.

## Non-goals

- Fixing `malformed_function_call`, or adding a retry or a friendlier error for it.
- Feature flags or a fallback path.
- Gemini through Google's OpenAI-compatible endpoint from a runner path that skips the
  gateway. See "Runner paths that bypass the gateway" in [design.md](design.md).
