# WP27 — tasks

Read [`specs-wp27.md`](specs-wp27.md) first. Branch from C2.

## Phase 0 — verification

Already closed before this package started (D40, `specs-wp27.md`): Bedrock rejects a body
that still carries `model`; Vertex has no attestation either way and drops it regardless.
Both operations ship. No live vendor call — nothing to do here but confirm the record in
`decisions.md` D40 stands. Do not repeat it.

## Phase 1 — the table and the applying function

- [ ] Add `LLMStaticFieldRewrite` (`fields_added: Dict[str, Any]`, `fields_removed:
      List[str]`) and `STATIC_FIELD_REWRITES: Dict[LLMDeploymentKind,
      LLMStaticFieldRewrite]` to a new `core/gateways/llms/providers/passthrough/
      static_fields.py`, with exactly the two entries D40 specifies.
- [ ] Add `apply_static_fields(*, deployment_kind, protocol, body) -> bytes`: a no-op unless
      `protocol == LLMProtocol.MESSAGES` and `deployment_kind` is in the table; otherwise
      `json.loads` the body, `pop()` each `fields_removed` name, `setdefault()` each
      `fields_added` pair, `json.dumps` back to bytes. On a non-dict or unparsable body,
      return it unchanged rather than raising — a malformed body is a policy-parse failure
      elsewhere, not this function's problem.
- [ ] Wire it into `RelayLLMAdapter.relay_chat_completion` (`providers/passthrough/
      adapter.py`): call it on `body` before building the outbound `httpx` request, after
      routing/auth are resolved.
- [ ] Unit: `BEDROCK` adds `anthropic_version: "bedrock-2023-05-31"` and removes `model`.
- [ ] Unit: `VERTEX` adds `anthropic_version: "vertex-2023-10-16"` and removes `model`.
- [ ] Unit: a body already carrying `anthropic_version` keeps its own value on both.
- [ ] Unit: a non-`MESSAGES` protocol leaves a `BEDROCK`/`VERTEX` body untouched.
- [ ] Unit: every other `deployment_kind` is untouched byte for byte on the Messages door.

## Phase 2 — proving the table can't read the request

- [ ] Unit: walk `STATIC_FIELD_REWRITES` and assert every `fields_added` value and every
      `fields_removed` entry is a literal (`str`/`int`/`float`/`bool`/`None`) — never a
      callable, never derived.
- [ ] Unit: `inspect.signature(apply_static_fields)` carries exactly `deployment_kind`,
      `protocol`, `body` — no parameter through which request semantics could enter beyond
      the raw bytes it patches generically.
- [ ] Add `static_fields.py` to `test_gateways_llm_no_body_conversion.py`'s `_ALLOWED` set,
      with the reason (D40's carve-out, table-driven, gated to `MESSAGES`).

## Phase 3 — the URL half (the pair the body half needs)

Removing `model` from the body is only correct if `route.model` actually reaches the
upstream some other way. `_bedrock_url`/`_vertex_url` in `routing.py` compose each vendor's
OpenAI-compatible door and never put the model id in the path — that is a different wire
from the one D40 is about, and leaving it as the Messages door's route would send a request
with `model` in neither the body nor the URL.

- [ ] Add `_bedrock_messages_url(route, *, stream) -> str`: `{base_url or
      https://bedrock-runtime.{region}.amazonaws.com}/model/{route.model}/{invoke |
      invoke-with-response-stream}`. Raise `_no_route` naming the provider, before any I/O,
      when `route.model` is missing.
- [ ] Add `_vertex_messages_url(route, *, stream) -> str`: `{base_url or
      https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}}
      /publishers/anthropic/models/{route.model}:{rawPredict | streamRawPredict}`. Same
      missing-model guard.
- [ ] `build_url` gains a `stream: bool = False` keyword and, when `protocol ==
      LLMProtocol.MESSAGES`, checks a `_MESSAGES_ROUTING` table for `BEDROCK`/`VERTEX` before
      falling through to the existing `_ROUTING` table — CHAT_COMPLETIONS/RESPONSES for those
      two kinds keep composing the OpenAI-compatible door exactly as before.
- [ ] `RelayLLMAdapter` passes `stream=context.stream` into `build_url` — the same field
      D33's policy parse already carries, so no new body read.
- [ ] Unit: Bedrock/Vertex Messages URL composition, non-streaming and streaming, plus the
      missing-model failure, plus a test proving CHAT_COMPLETIONS/RESPONSES for the same two
      kinds are byte-identical to before this phase.
- [ ] Unit, the pairing test: one test per kind, through `RelayLLMAdapter`, asserting both
      halves together — outbound URL contains `route.model`, outbound body does not — so the
      two halves are checked in the same assertion and cannot silently drift apart again.
- [ ] `ruff format` && `ruff check --fix`; run the API unit tests.
- [ ] Commit: "gateways(llm): static field rewrite for resold Anthropic wires (D40)".

## Definition of done

- The two deployments' table entries exist and are applied on the Messages front door.
- The Messages door's URL for both kinds is the real InvokeModel/rawPredict shape, with
  `route.model` in the path; CHAT_COMPLETIONS/RESPONSES for the same two kinds are unchanged.
- A test proves no table entry or the applying function reads the request.
- A test proves the URL and body halves together: model out of the body, into the URL.
- Every other deployment still relays byte for byte; Bedrock and Vertex are named as the
  exemption, not folded into a weakened universal assertion.
