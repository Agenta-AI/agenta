# Status

Updated 2026-10-14.

## State

Implemented, PR open against `release/v0.122.6` (branch
`fix/gateway-gemini-thought-signatures`).

This is an architecture change, not a bug fix. Signatures most likely round-trip correctly
today through the runner extension, and the skip value lands only on unsigned parallel
siblings, where Google does not check it. The `malformed_function_call` in production session
`65a8da03` is probably unrelated to signatures, and this change is not expected to fix it.

## Decisions

- The gateway owns signatures, with the LiteLLM id encoding. Decided by Mahmoud.
- The runner extension, its registration and its tests are deleted in the same PR. Decided
  by Mahmoud.
- The gateway's skip value is deleted. Decided by Mahmoud.
- No retry or friendlier error for `malformed_function_call`. Decided by Mahmoud.
- The rewrite runs only on chat completions on `VERTEX` and on `DIRECT` with provider key
  `gemini`.

## Done

- Captured Google's wire shape on 2026-10-14 from Vertex's OpenAI-compatible endpoint with
  the staging gateway service account. The id and the signature share one delta, only the
  first parallel call is signed, and an unsigned sibling is accepted. Evidence is in
  `~/agenta-gemini-thought-signatures-evidence/vertex-gemini-3.7-flash/`.
- The direct Gemini API key in the staging secret and in `hosting/docker-compose/ee/.env.ee.dev`
  is rejected by Google ("Please pass a valid API key"), so the direct `gemini` route was not
  captured. It is the same Google OpenAI-compatible format.
- Codex's review: the reader handles whole lines before the size check and fails a Gemini
  stream on a single oversized line; non-Gemini chat routes drop the `__thought__` suffix;
  a `CUSTOM` connection to Google's OpenAI endpoint is unsupported; names are
  `encode_thought_signatures` and `_StreamReader`.
- Live round trip on 2026-10-14 against Vertex (`google/gemini-3.7-flash`) through the
  changed gateway functions, with a client that drops `extra_content`: the parallel step,
  the sequential step and the answer all returned HTTP 200, and the same step-2 history
  without the gateway's request rewrite returned HTTP 400. Evidence:
  `~/agenta-gemini-thought-signatures-evidence/round-trip-2026-10-14/`.

## Open

- The direct `gemini` route was not captured live (the available key is rejected). It is
  the same Google OpenAI-compatible format and is covered by unit tests.

## Size

355 lines added and 620 removed, so 265 net removed. See "Cost per change" in
[design.md](design.md).
