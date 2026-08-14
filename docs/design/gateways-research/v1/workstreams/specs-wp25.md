# WP25 — A refusal arrives as a cause, not a sentence

**Owns:** `api/oss/src/apis/fastapi/gateways/utils.py` (the shared marker), `gateways/llms/
proxy.py` and `gateways/mcps/proxy.py` (both apply it), `services/runner/src/gateway-error.ts`
(the marker fallback), `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`, and
`open-designs.md` OD18.
**Depends on:** C2. **Blocks:** WP19, WP26.

D35 requires a gateway target to be registered before an agent can use it. That makes a
registration gap a normal failure mode, not an edge case, so the refusal it produces has to
reach the agent as something it can act on. Both gateway planes raise a typed domain error for a
missing credential, a rejected one, an unregistered target and a deactivated endpoint; the LLM
plane additionally raises one for a disallowed model. Done means every one of those reaches the
caller carrying its cause, proven per harness AND per plane — not assumed, and not merely
recorded as lost where it is. WP26 (an agent requesting a missing connection) needs the MCP
plane's version of this channel specifically — that is the plane its own affordance runs on.

---

## What arrives already built

`AgentErrorDetail` (`services/runner/src/protocol.ts`) is `{code, message, retryable, next_step?,
details?}` on `AgentRunResult.errorDetail`. `gateway-error.ts`'s `parseGatewayErrorDetail`
recovers it from a harness-reported error string, and `engine.ts`'s `withGatewayErrorDetail`
attaches it at the runner's single choke point. On the Python side, `AgentRunFailed`
(`sdks/python/agenta/sdk/agents/errors.py`) carries `error_detail` and promotes its `code` to
`failure_code`; `result_from_wire` (`utils/wire.py`) raises it with
`error_detail=data.get("errorDetail")` when the wire result is `ok: false`.

Do not invent a second shape.

## The refusals, by their actual code, on each plane

`_map_domain_exception` (`gateways/llms/proxy.py`) maps each LLM-plane domain exception to an
OpenAI-shaped `{"error":{"message","type","code"}}` body; `_map_gateway_exception`
(`gateways/mcps/proxy.py`) maps each MCP-plane one to a JSON-RPC error result carrying a stable
`cause` in `error.data`. Same causes, two wire shapes:

| launch-3.md's refusal | LLM exception | LLM `code` | MCP exception | MCP `cause` |
| --- | --- | --- | --- | --- |
| missing credential | `SecretNotFoundError` | `secret_missing` | `SecretNotFoundError` | `secret_missing` |
| rejected credential | `SecretInvalidError` | `secret_invalid` | `SecretInvalidError` | `secret_invalid` |
| unregistered target | `LLMEndpointNotFoundError` | `endpoint_not_found` | `MCPEndpointNotFoundError` | `endpoint_not_found` |
| disallowed model | `LLMModelNotAllowedError` | `model_not_allowed` | — (no MCP equivalent) | — |
| deactivated endpoint | `GatewayEndpointInactiveError` | `endpoint_inactive` | `GatewayEndpointInactiveError` | `endpoint_inactive` |

**`SecretInvalidError` was not wired on the LLM plane before this package.** It is raised by the
shared secret resolver (`policy/resolution.py`, both planes) when a bound secret exists but
`is_valid` is false — the actual "rejected credential" case — but the LLM plane's
`_map_domain_exception` had no branch for it and `_DOMAIN_EXCEPTIONS` (the tuple its `except`
clause catches) did not list it either. It would have reached the caller as an unhandled 500,
not a typed refusal. Fixed here: mapped to `secret_missing`'s sibling `secret_invalid` (409) and
added to `_DOMAIN_EXCEPTIONS`.

**The same audit, run on the MCP plane, found no gap.** Every exception
`core/gateways/mcps/service.py`/`registry.py` actually raise has a branch in
`_map_gateway_exception` and is listed in `_MAPPED_EXCEPTIONS` — `SecretInvalidError` included,
already correct there. `CeilingExceededError`/`EntitlementDeniedError`/`MCPAuthRequiredError`/
`MCPScopeInsufficientError` are mapped but not currently raised on this plane (reserved for
ceiling/entitlement/step-up work not yet built, WP16-20) — not a gap, just unexercised.

`upstream_error` (`LLMUpstreamError` / `MCPUpstreamError`) is not one of the refusals above on
either plane — it is the upstream's own detail, forwarded untouched (D16) — and is excluded from
everything below, on both planes identically.

## Two channels the cause can travel by, tried in order

**1. The JSON body, verbatim, in the harness's error text.** For the LLM plane,
`parseGatewayErrorDetail` scans for the gateway's `{"error":{...}}` object and recovers the full
envelope when it finds one — `code`, `message`, `next_step`, `details`. This path is unchanged
by this package and is LLM-only by construction: the MCP plane's JSON-RPC shape keeps its stable
cause at `error.data.cause` under a numeric `error.code`, which the scan's
`typeof body.code === "string"` check never matches — so this channel never recovers an MCP
refusal, full body or not, on any harness.

**2. A marker inside `message`, when the body itself is gone (or never matched).** Verifying
channel 1 per harness (OD18) found one that discards the body's structure entirely but keeps its
`message` field untouched: Codex's `codex-rs` (`UnexpectedResponseError::extract_error_message`)
parses the JSON response, pulls out `error.message`, and throws the rest away before formatting
`"unexpected status {n}: {message}"`. No brace survives for channel 1's scan. Left there, Codex
would satisfy neither this package's "done when" (a code reaching the caller) nor WP19/WP26 (a
channel to build step-up and connection-request on).

The fix is on the gateway's side, and Codex's own behavior names it: `message` survives on every
harness examined, Codex included — it is the one field codex-rs keeps, on either plane's wire.
So every TYPED refusal, on BOTH planes, now renders its `message` with a marker appended
(`with_code_marker`, `gateways/utils.py` — shared by `llms/proxy.py`'s `_openai_error` and
`mcps/proxy.py`'s `_protocol_error` rather than copied, the CU12 lesson applied here too):

```
<message> ⟦agenta_code:<code>⟧
```

**The delimiter.** U+27E6/U+27E7 (MATHEMATICAL LEFT/RIGHT WHITE SQUARE BRACKET). Chosen because
they do not occur in ordinary error prose, in a model's own output, in JSON's own delimiters
(`{`/`}`/`[`/`]`), or in markdown — nothing else in the text a harness reports can produce or be
mistaken for this exact sequence, and it is visually and byte-wise distinct from the `{...}`
channel 1 scans for, so the two recovery paths cannot interfere with each other. A plain-ASCII
tag (`[agenta_code:...]`) was rejected: square brackets are common in prose and in a model's own
formatted output (citations, markdown links, tool-call syntax), so a false match — recovering
the wrong code, or recovering one from text that never carried a real refusal — was a real risk
a rare Unicode pair avoids entirely.

`gateway-error.ts` scans for the marker as a **fallback** on the LLM plane (only after the body
scan fails) and as the **only channel** on the MCP plane (the body scan never matches its shape
at all — see above):

- **Recovers `code` only.** `retryable` and `next_step` and `details` do not survive a
  marker-only recovery — they are never backfilled from the runner's own `NEXT_STEPS` table,
  so a caller can tell "code only" from "the full envelope" by whether those fields are present.
  On the MCP plane this means every recovery is code-only today, since that plane's body never
  reaches channel 1.
- **Excluded from `upstream_error`.** D16 forwards the upstream's own detail untouched; this
  surface must not inject text into a body it promised not to touch, so both `_openai_error`'s
  and `_protocol_error`'s `marked` flag is `False` for that one cause, on both planes.
- **Message is marker-stripped for display.** The recovered `AgentErrorDetail.message` has the
  marker removed, so a caller surfacing it to a human never shows the raw bracket text.

**What WP19/WP26 must do with a code-only recovery.** When `next_step`/`details` are absent,
degrade to a generic step-up/connect prompt ("this connection needs attention") rather than
assume a specific one — the marker path proves a cause exists and names it, but not what to tell
the user to do about it beyond that. On the MCP plane, plan for this being the NORMAL case, not
a fallback.

**Claude Code's unverified status matters less now.** Whether the Claude Code CLI's own SDK
preserves the full JSON body in the text it reports is still not verifiable from source — the
CLI is a compiled, closed-source binary (`@anthropic-ai/claude-agent-sdk`'s
`extractFromBunfs.js`), the same limit OD14 hit on this package. That stays recorded as
unverified rather than guessed past. But since the marker rides inside `message`, the one field
every harness examined — Pi, the Anthropic SDK, and Codex — keeps intact, `code` survives on
Claude Code regardless of which way that unverified question resolves. The only thing still
riding on it is `retryable`/`next_step`/`details`, none of which were load-bearing for this
package's own "done when."

## Gap 2 — the agent service never surfaced `errorDetail` onto its stream

`AgentRunFailed.error_detail` reaches Python intact (confirmed by reading `wire.py` and
`streaming.py`: nothing between `result_from_wire` and the vercel adapter catches or rewraps the
exception). But `stream.py`'s `_error_parts` — the single function both
`agent_run_to_vercel_parts` and `agent_stream_to_vercel_stream` call from their terminal
`except Exception` handlers — read only `getattr(error, "failure_code", None)` for the
`data-agent-error` part's `code` field. It never read `error_detail`, so `retryable`,
`next_step` and `details` stopped at the Python boundary even when the runner recovered them.

**The fix:** `_error_parts` also reads `getattr(error, "error_detail", None)` and, when present,
carries it whole as `errorDetail` on the `data-agent-error` part's `data`. `code` and `errorText`
are unchanged (a caller reading only those two fields sees no difference); `errorDetail` is
additive, mirroring how it is additive-and-optional on the runner's own `AgentRunResult`. No
wire-shape change — `errorDetail`'s field names are already the platform's agent-actionable
envelope (`api/AGENTS.md`).

## Contracts

- **One shape.** `errorDetail` on the vercel stream is exactly `AgentErrorDetail`, byte-for-byte
  what the runner attached. No renamed fields, no flattening.
- **`error`/`errorText` never regresses.** A caller reading only the existing string field keeps
  working unchanged; `errorDetail` is purely additive.
- **`code`/`cause` reaches every harness for every refusal, on both planes.** Proven, not
  assumed: the body path for Pi and (inferred but marker-backed) Claude Code on the LLM plane,
  the marker path for Codex on the LLM plane and for every harness on the MCP plane. Nothing
  degrades silently to a bare `error`/`errorText` string with no code for any of them.
- **A marker-only recovery is distinguishable from a full one.** `next_step`/`details` present
  means the body survived; absent means only the marker did. WP19/WP26 branch on that, not on
  which harness or which plane is running.
- **The marker never touches `upstream_error`, on either plane.** D16's byte-for-byte forwarding
  of the upstream's own detail is unconditional and plane-independent.
- **One marker implementation, not two.** `with_code_marker` lives once, in `gateways/utils.py`,
  imported by both proxies. A change to the delimiter or the rendering changes both planes from
  one place.

## Tests

- Unit (`api`): on each plane, every typed refusal's rendered `message` ends with its marker;
  `upstream_error`'s never contains one; `SecretInvalidError` maps to `secret_invalid`/reaches
  the caller as a typed refusal rather than an unhandled exception, on the plane where that was
  previously untrue (LLM) and re-confirmed on the plane where it was already true (MCP).
- Unit (`services/runner`): per LLM refusal code, two fixtures — the Pi/Anthropic-SDK shape
  (body intact, marker riding inside it) recovering the full envelope via the body path, and
  Codex's stripped shape (`"unexpected status {n}: {message} ⟦agenta_code:{code}⟧"`) recovering
  `code` alone via the marker path, with `next_step`/`details` asserted absent. Per MCP refusal
  cause, two more fixtures — the full JSON-RPC body embedded verbatim (still only the marker
  recovers it, proving the body path never matches this plane's shape) and the Codex-stripped
  shape (marker recovers it same as the LLM plane).
- Unit (`sdks/python`): `_error_parts` / the two vercel projection functions, given a mock
  `AgentRunFailed` carrying `error_detail`, emit a `data-agent-error` part whose
  `data.errorDetail` equals it; given a plain exception (no `error_detail`), the part carries no
  `errorDetail` key (not even `null`). Exercised for all five refusal codes end-to-end from a
  `result_from_wire`-shaped `{"ok": false, ...}` dict.

## Out of scope

- The local-agent fallback (OD14's shape) — not needed here; the marker closes the gap it would
  have existed for.
- `request_connection` / the step-up interaction (WP26, WP19) — this package only makes the cause
  reach the caller; acting on it is the next package's job.
- Any change to the gateway's byte-for-byte relay of a live upstream response — the marker only
  touches pre-dial refusals the gateway itself constructs.
