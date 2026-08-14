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

## Phase 3 — naming the exemption

- [ ] In the acceptance suite (`test_llm_gateway_proxy_acceptance.py`), add a written-not-run
      class covering a `BEDROCK` and a `VERTEX` endpoint pointed at the mock upstream over the
      Messages door, asserting a completion comes back and that these two are the byte-for-byte
      exemption — do not touch the existing byte-for-byte assertions for any other deployment.
- [ ] `ruff format` && `ruff check --fix`; run the API unit tests.
- [ ] Commit: "gateways(llm): static field rewrite for resold Anthropic wires (D40)".

## Definition of done

- The two deployments' table entries exist and are applied on the Messages front door.
- A test proves no table entry or the applying function reads the request.
- Every other deployment still relays byte for byte; Bedrock and Vertex are named as the
  exemption, not folded into a weakened universal assertion.
