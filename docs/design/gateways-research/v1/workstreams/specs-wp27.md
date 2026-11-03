# WP27 — The static field rewrite for the one resold wire that still needs it (D40, OD19)

**Owns:** `core/gateways/llms/providers/passthrough/static_fields.py`, the Messages-door URL
strategies in `providers/passthrough/routing.py`, wired into `RelayLLMAdapter`
(`providers/passthrough/adapter.py`).
**Depends on:** C2. **Blocks:** nothing.

D34 forbids body conversion. D40 carves out one bounded exception: Vertex's `rawPredict` resells
the Anthropic Messages wire with a fixed structural difference — `anthropic_version` must be in
the body and `model` must not be, because the model id rides the URL. Bedrock does not need this
carve-out: its Messages door is `bedrock-mantle`, not `InvokeModel` (below), and mantle needs no
rewrite at all.

## `base_url`: one definition, host-only, shared by every door a kind serves

OD19's finding: a stored `base_url` must mean the same thing on every door a deployment kind
serves, or a row that works on one door composes a wrong URL on another. The fix is to make
`base_url` **a host override and nothing more** — never a full per-door URL — with each door
appending its own tail on top of it. Per kind:

- **`DIRECT`**: `base_url` overrides the catalogued host (`routing.py`'s `DIRECT_BASE_URLS`).
  Tail is the protocol path alone (`/chat/completions`, `/responses`, `/messages`).
- **`CUSTOM`**: `base_url` is required and is the whole address up to the protocol path. Same
  tail convention as `DIRECT`.
- **`AZURE`**: `base_url` is the resource host (e.g. `https://acme.openai.azure.com`). Tail is
  `/openai/deployments/{route.model}/{chat/completions|responses}?api-version=...`.
- **`BEDROCK`**: `base_url` is the host alone — `https://bedrock-mantle.{region}.api.aws` when
  unset, or a private host such as a VPC interface endpoint
  (`https://vpce-{id}.bedrock-runtime.{region}.vpce.amazonaws.com`) when set. Every door on this
  kind now speaks mantle, so the same host serves all three: `/v1/chat/completions`,
  `/v1/responses`, `/anthropic/v1/messages`.
- **`VERTEX`**: `base_url` is the host **plus** the shared
  `/v1/projects/{project}/locations/{region}` prefix — the part every Vertex door has in common.
  Each door appends only its own tail beyond that: `/endpoints/openapi/{chat/completions|
  responses}` for the OpenAI-compatible door, `/publishers/anthropic/models/{route.model}:
  {rawPredict|streamRawPredict}` for the Anthropic door. One stored string serves both, which is
  the shape OD19 asked for.
- **`SAGEMAKER`**: unreachable regardless of `base_url` (OD16).

**Why the field is not decoration.** Both Bedrock and Vertex publish private-network addresses
that replace only the host: Bedrock through VPC interface endpoints, Vertex through Private
Service Connect. Forbidding `base_url` on these two kinds would make the gateway unusable from a
VPC-only deployment. `base_url` being a pure host override, consistently defined, is what makes
that substitution safe on every door at once instead of only the one a row happened to be tested
against.

**Still latent, as before.** No seed, fixture, or acceptance test in this codebase registers a
Bedrock or Vertex row with an explicit `base_url`. `LLMEndpointCreate`/`LLMEndpointRoute` accept
the field with no per-`deployment_kind` validation. The ambiguity OD19 opened against is closed at
the definition level now — a future caller that sets `base_url` on either kind gets one coherent
meaning across every door, not a per-door landmine.

## Bedrock's Messages door moves to `bedrock-mantle`

`bedrock-runtime.{region}.amazonaws.com` carries `InvokeModel`, which needs the D40-shaped
rewrite (model out of the body, `anthropic_version` into it). But Bedrock also serves the
Anthropic Messages API on a second, current-generation endpoint,
`bedrock-mantle.{region}.api.aws`, natively: model stays in the body exactly as a native
Anthropic client sends it, and the version travels as the `anthropic-version` **header** a native
client already sets — not a body field. Routing the Messages door there instead of `InvokeModel`
removes the need for any rewrite on Bedrock:

- **Bedrock Messages**: `POST {base}/anthropic/v1/messages`, where `{base}` is `route.base_url`
  or, when unset, `https://bedrock-mantle.{route.region}.api.aws`. `route.model` is left in the
  body untouched — there is no model segment in this URL.
- This is the same host `_bedrock_url` already composes for the OpenAI-compatible doors
  (`/v1/chat/completions`, `/v1/responses`), so `routing.py` no longer needs a Messages-only
  Bedrock strategy at all: one function, keyed by protocol, handles all three doors for
  `BEDROCK`.
- No stream-specific URL variant. Mantle's Anthropic surface streams via the body's own `stream`
  flag, the same way the native Anthropic API and the OpenAI-compatible doors already do — unlike
  `InvokeModel`, which named streaming as a separate operation
  (`invoke-with-response-stream`). The `stream` parameter `build_url` still accepts is simply
  unused for `BEDROCK`.

**Vertex is unchanged by this move** — it has no equivalent second door; `rawPredict` is the only
way to reach Claude models on Vertex, so its rewrite entry and its model-in-URL routing strategy
both stand exactly as before.

## The version header and the auth header, verified against mantle

A native Anthropic client sends `anthropic-version: 2023-06-01` on every Messages call — exactly
the header mantle wants, and it needs no equivalent in the body. `RelayLLMAdapter`'s stripped-
header set (`adapter.py`, `_STRIPPED_HEADERS`) contains only hop-by-hop headers and the gateway's
own credentials header; `anthropic-version` is not in it, so a caller's header passes through
unmodified. This is forwarding, not injection — D34 still forbids inventing content, and nothing
here adds the header if the caller omitted it.

Bedrock's auth strategy (`auth.py`, `_bedrock_auth`) already presents a Bedrock API key as
`Authorization: Bearer <key>` rather than SigV4 — that was written for the OpenAI-compatible doors
when they moved to mantle, and is exactly what mantle's Messages surface accepts too, unchanged by
this package. Both facts were checked, not assumed; nothing needed to change to make them true.

**A `route.model` missing on the Messages door for `VERTEX` still raises before any I/O**, naming
the provider — Vertex still needs the model id to build the URL. `BEDROCK` has no equivalent
check: mantle takes the model from the body, so the routing strategy never inspects `route.model`
for this door.

## The trade AWS's own documentation disagrees on — recorded, not resolved

AWS's Bedrock endpoint-comparison page states `bedrock-mantle` does **not** support structured
outputs on Messages (`output_config.format` rejected with 400), cross-region inference profiles,
guardrails, or intelligent prompt routing. AWS's Messages API reference page, separately, lists
structured outputs among the Messages API's supported features with no endpoint carve-out. **The
two pages disagree**, and this package does not pick a side — it is not this package's call to
make, and doing so would be inventing a fact rather than reading one. What is settled regardless
of which page is right: `bedrock-runtime` remains the endpoint for cross-region inference
profiles, guardrails, and intelligent prompt routing, none of which this relay-only package
builds a path to. No fallback between the two Bedrock endpoints is built here — an endpoint is
chosen once, by `deployment_kind` and door, never switched per-request. That trade-off is a later
decision if a caller ever needs guardrails or profiles on a Messages-shaped Bedrock call.

---

## Phase 0 — already closed

Whether a rewritten body that still carried `model` was rejected or merely ignored was the open
question for Vertex specifically (Bedrock's `InvokeModel` — no longer routed to — was attested to
reject it with `Malformed input request: #: extraneous key [model] is not permitted`, the finding
that first established the removal half was necessary at all). Vertex has no attestation either
way and removes it regardless, because removing a field the endpoint does not read costs nothing.
No live vendor call was made or is needed. See D40 for the full citation trail.

## The table

One literal entry, of the exact shape D40 permits:

```python
STATIC_FIELD_REWRITES: Dict[LLMDeploymentKind, LLMStaticFieldRewrite] = {
    LLMDeploymentKind.VERTEX: LLMStaticFieldRewrite(
        fields_added={"anthropic_version": "vertex-2023-10-16"},
        fields_removed=["model"],
    ),
}
```

The list is literal: fixed key names, a fixed constant value, nothing computed from the request.
`fields_added` uses **setdefault semantics** — a caller who already sent `anthropic_version` is
not overwritten, mirroring how the vendor SDKs treat the field.

**Keyed by `deployment_kind`, not by a finer identifier.** Every `VERTEX` route reaches
`rawPredict` (`routing.py`'s `_vertex_messages_url`); there is no second Vertex Messages
operation this table would need to distinguish.

**Gated to the Messages front door.** The rewrite only applies when
`context.protocol == LLMProtocol.MESSAGES`. A `VERTEX` route hit through a different door (which
nothing in this codebase configures on purpose) is left untouched rather than mangled.

## Why the applying function cannot become conversion

`apply_static_fields(*, deployment_kind, protocol, body) -> bytes` takes only those three
parameters. It does one generic thing: look up the deployment's table entry, `pop()` each
name in `fields_removed`, `setdefault()` each pair in `fields_added`. It never inspects a
value already in the body, never branches on a field's content, and never takes a parameter
that could carry request semantics beyond the body it patches generically. **The function's
signature is the proof, not a docstring's claim** — a unit test asserts the signature directly
so a future edit that smuggles in a fourth "helpful" parameter fails loudly.

## What this is not

- Not a general body-rewrite mechanism. The table has exactly one entry; a second deployment
  needing this shape earns its own literal entry, not a parameterized rule.
- Not an auth strategy, and `static_fields.py` itself is not a routing strategy either — it
  runs on the body only, after the URL is built and after auth is resolved, immediately
  before the adapter hands bytes to `httpx`. The URL half of the pair lives in `routing.py`'s
  own Messages-only Vertex strategy, described above, which never touches the body.
- Not a relaxation of D34's byte-for-byte relay elsewhere. Every other deployment, `BEDROCK`
  included, is untouched by this file; `apply_static_fields` is a no-op whenever
  `deployment_kind` is not the one table key.

## Contracts

- **The table is the only place either operation is named.** No deployment-kind branch
  anywhere else in `core/gateways/llms/` adds or removes a body field.
- **`apply_static_fields` never reads a value to decide anything.** Checkable by its
  signature and by the fact that it never compares a payload value against anything.
- **Byte-for-byte relay is no longer universal.** `VERTEX` is the named exemption; every other
  deployment kind, `BEDROCK` included, is unaffected and stays byte-for-byte, request and
  response, streamed and not.
- **The response is never touched.** D40 amends what the gateway sends, not what it returns;
  `RelayLLMAdapter`'s response-side discipline (bytes yielded are the bytes received) is
  unchanged.
- **`base_url`, when a row sets one, means the same host override on every door the row's
  `deployment_kind` serves.** No routing strategy reads it as a full per-door URL.

## Tests

- Unit: `VERTEX` route removes `model` and adds `anthropic_version: "vertex-2023-10-16"`.
- Unit: a body that already carries `anthropic_version` keeps its own value (setdefault, not
  overwrite).
- Unit: a non-`MESSAGES` protocol body is untouched even on a `VERTEX` route.
- Unit: every other `deployment_kind`, `BEDROCK` included, is untouched, byte for byte, on the
  Messages door.
- Unit: the table has exactly one entry (`VERTEX`), and it is data-only — every `fields_added`
  value and every `fields_removed` entry is a literal (`str`/`int`/`float`/`bool`/`None`), never
  a callable.
- Unit: `apply_static_fields`'s signature carries only `deployment_kind`, `protocol`, `body` —
  proof the function cannot see anything beyond the table and the raw bytes.
- Guard: the existing "no unexpected `json.loads`" test
  (`test_gateways_llm_no_body_conversion.py`) allows `static_fields.py`, with the reason
  recorded there rather than the assertion being loosened.
- Unit: `routing.py`'s Messages door composes `{base}/anthropic/v1/messages` for `BEDROCK`
  (model left in the body, no stream-specific path) and
  `.../publishers/anthropic/models/{model}:rawPredict` (`:streamRawPredict` when streaming) for
  `VERTEX`; CHAT_COMPLETIONS/RESPONSES for both kinds are unchanged; a missing `route.model` on
  the Messages door raises for `VERTEX` before any I/O, naming the provider.
- Unit: a stored `base_url` on `BEDROCK` composes correctly across all three of its doors
  (`/v1/chat/completions`, `/v1/responses`, `/anthropic/v1/messages`); a stored `base_url` on
  `VERTEX` (host + shared prefix) composes correctly across both of its doors
  (`/endpoints/openapi/...`, `/publishers/anthropic/models/{model}:rawPredict`).
- Unit, the pairing test for `VERTEX` on the Messages door: one test asserts both halves
  together — the outbound URL contains `route.model` AND the outbound body does not — through
  `RelayLLMAdapter` end to end, so the two halves cannot drift apart.
- Unit, the Bedrock counterpart: one test asserts the outbound URL is the mantle Messages
  address AND the outbound body is byte-for-byte identical, including `model` — the negative
  space of the Vertex pairing test, proving Bedrock genuinely needs nothing.
- Acceptance: no acceptance test covers the URL half for either kind. The mock upstream mounts
  only `/v1/{chat/completions,responses,messages}` (`providers/mock/app.py`); it does not speak
  Vertex's real `rawPredict` path shape or Bedrock mantle's `/anthropic/v1/messages` path, so an
  acceptance test pointed at it would prove nothing about the composed URL and was not added.
  Written-not-run acceptance coverage for the general Messages door (not these two kinds'
  specifics) already exists in `test_llm_gateway_proxy_acceptance.py`.

## Out of scope

- Any other resold wire. If a third vendor turns up reselling a body with a fixed structural
  difference, it earns its own D40-shaped decision and its own table entry — this package does
  not generalize ahead of that.
- Anything OD16 already settled about whether Bedrock/Vertex are reachable at all; this package
  assumes they are (D40, `routing.py`, `auth.py`) and only adds the one remaining field rewrite.
- Choosing between `bedrock-runtime` and `bedrock-mantle` per request. The endpoint is fixed by
  `deployment_kind` and door; a caller needing `bedrock-runtime`'s exclusive capabilities
  (structured outputs per one AWS page, cross-region inference profiles, guardrails, intelligent
  prompt routing) is not served by this package's Messages door, and no fallback is built.
