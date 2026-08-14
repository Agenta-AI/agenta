# WP27 — The static field rewrite for resold Anthropic wires (D40)

**Owns:** `core/gateways/llms/providers/passthrough/static_fields.py`, wired into
`RelayLLMAdapter` (`providers/passthrough/adapter.py`).
**Depends on:** C2. **Blocks:** nothing.

D34 forbids body conversion. D40 carves out one bounded exception: Bedrock's `InvokeModel`
and Vertex's `rawPredict` both resell the Anthropic Messages wire with a fixed structural
difference — `anthropic_version` must be in the body and `model` must not be, because the
model id rides the URL on both. This package implements that carve-out and nothing wider.

---

## Phase 0 — already closed

Whether a Bedrock body that still carries `model` is rejected or merely ignored was the open
question; if ignored, the removal half would have been unnecessary. It is rejected — Bedrock's
Anthropic body is validated against a closed schema and answers an unknown key with
`Malformed input request: #: extraneous key [model] is not permitted`. Vertex has no
attestation either way and removes it regardless, because it is the same table entry. **Both
operations ship.** No live vendor call was made or is needed; this package does not repeat
that verification. See D40 for the full citation trail.

## The table

One literal entry per deployment, of the exact shape D40 permits:

```python
STATIC_FIELD_REWRITES: Dict[LLMDeploymentKind, LLMStaticFieldRewrite] = {
    LLMDeploymentKind.BEDROCK: LLMStaticFieldRewrite(
        fields_added={"anthropic_version": "bedrock-2023-05-31"},
        fields_removed=["model"],
    ),
    LLMDeploymentKind.VERTEX: LLMStaticFieldRewrite(
        fields_added={"anthropic_version": "vertex-2023-10-16"},
        fields_removed=["model"],
    ),
}
```

Both lists are literal: fixed key names, a fixed constant value, nothing computed from the
request. `fields_added` uses **setdefault semantics** — a caller who already sent
`anthropic_version` is not overwritten, mirroring how the vendor SDKs treat the field.

**Keyed by `deployment_kind`, not by a finer identifier.** Every `BEDROCK` route reaches
`InvokeModel` and every `VERTEX` route reaches `rawPredict` (`routing.py`'s
`_bedrock_url`/`_vertex_url`); there is no second Bedrock or Vertex operation this table would
need to distinguish.

**Gated to the Messages front door.** The rewrite only applies when
`context.protocol == LLMProtocol.MESSAGES`. Bedrock and Vertex resell exactly that wire —
that is the entire premise of D40 — so a `BEDROCK`/`VERTEX` route hit through a different door
(which nothing in this codebase configures on purpose) is left untouched rather than mangled.

## Why the applying function cannot become conversion

`apply_static_fields(*, deployment_kind, protocol, body) -> bytes` takes only those three
parameters. It does one generic thing: look up the deployment's table entry, `pop()` each
name in `fields_removed`, `setdefault()` each pair in `fields_added`. It never inspects a
value already in the body, never branches on a field's content, and never takes a parameter
that could carry request semantics beyond the body it patches generically. **The function's
signature is the proof, not a docstring's claim** — a unit test asserts the signature directly
so a future edit that smuggles in a fourth "helpful" parameter fails loudly.

## What this is not

- Not a general body-rewrite mechanism. The table has exactly two entries; a third deployment
  needing this shape earns its own literal entry, not a parameterized rule.
- Not a routing or auth strategy. It runs after both, on the body only, immediately before the
  adapter hands bytes to `httpx`.
- Not a relaxation of D34's byte-for-byte relay elsewhere. Every other deployment is untouched
  by this file; `apply_static_fields` is a no-op whenever `deployment_kind` is not one of the
  two table keys.

## Contracts

- **The table is the only place either operation is named.** No deployment-kind branch
  anywhere else in `core/gateways/llms/` adds or removes a body field.
- **`apply_static_fields` never reads a value to decide anything.** Checkable by its
  signature and by the fact that it never compares a payload value against anything.
- **Byte-for-byte relay is no longer universal.** `BEDROCK` and `VERTEX` are the named
  exemption; every other deployment kind is unaffected and stays byte-for-byte, request and
  response, streamed and not.
- **The response is never touched.** D40 amends what the gateway sends, not what it returns;
  `RelayLLMAdapter`'s response-side discipline (bytes yielded are the bytes received) is
  unchanged.

## Tests

- Unit: `BEDROCK` route removes `model` and adds `anthropic_version: "bedrock-2023-05-31"`.
- Unit: `VERTEX` route removes `model` and adds `anthropic_version: "vertex-2023-10-16"`.
- Unit: a body that already carries `anthropic_version` keeps its own value (setdefault, not
  overwrite) on both deployments.
- Unit: a non-`MESSAGES` protocol body is untouched even on a `BEDROCK`/`VERTEX` route.
- Unit: every other `deployment_kind` is untouched, byte for byte, on the Messages door.
- Unit: the table is data-only — every `fields_added` value and every `fields_removed` entry
  is a literal (`str`/`int`/`float`/`bool`/`None`), never a callable.
- Unit: `apply_static_fields`'s signature carries only `deployment_kind`, `protocol`, `body` —
  proof the function cannot see anything beyond the table and the raw bytes.
- Guard: the existing "no unexpected `json.loads`" test
  (`test_gateways_llm_no_body_conversion.py`) adds `static_fields.py` to its allowed set, with
  the reason recorded there rather than the assertion being loosened.
- Acceptance (written, not run — no live vendor and no deployed stack in this worktree,
  `api/AGENTS.md`): a Messages request through a `BEDROCK`/`VERTEX` endpoint pointed at the
  mock upstream returns a completion; the mock's own byte-for-byte suite documents these two
  deployment kinds as the named exemption rather than weakening its assertion.

## Out of scope

- Any other resold wire. If a third vendor turns up reselling a body with a fixed structural
  difference, it earns its own D40-shaped decision and its own table entry — this package does
  not generalize ahead of that.
- Anything OD16 already settled about whether Bedrock/Vertex are reachable at all; this
  package assumes they are (D40, `routing.py`, `auth.py`) and only adds the field rewrite.
