# WP25 — A refusal arrives as a cause, not a sentence

**Owns:** `services/runner/src/gateway-error.ts` (verification only, no logic change),
`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`, and `open-designs.md` OD18.
**Depends on:** C2. **Blocks:** WP19.

D35 requires a gateway target to be registered before an agent can use it. That makes a
registration gap a normal failure mode, not an edge case, so the refusal it produces has to
reach the agent as something it can act on. The gateway already raises typed domain errors for a
missing credential, a rejected one, an unregistered target, a disallowed model and a deactivated
endpoint. What is unproven is that the cause survives gateway → harness → runner → agent service
→ caller.

---

## What arrives already built

`AgentErrorDetail` (`services/runner/src/protocol.ts`) is `{code, message, retryable, next_step?,
details?}` on `AgentRunResult.errorDetail`. `gateway-error.ts`'s `parseGatewayErrorDetail`
recovers it by scanning a harness-reported error string for the gateway's own
`{"error":{"message","type","code",...}}` body, and `engine.ts`'s `withGatewayErrorDetail`
attaches it at the runner's single choke point. On the Python side, `AgentRunFailed`
(`sdks/python/agenta/sdk/agents/errors.py`) already carries `error_detail` and promotes its
`code` to `failure_code`; `result_from_wire` (`utils/wire.py`) already raises it with
`error_detail=data.get("errorDetail")` when the wire result is `ok: false`.

Do not invent a second shape. This package's job is verifying the first half survives per
harness, and closing the one place the second half stops short of the caller.

## Gap 1 — verify, per harness, before touching code

`parseGatewayErrorDetail` is a best-effort text scan. Whether a given harness's SDK folds the
gateway's JSON body into the error text it reports is a fact about that harness's release, not
something the parser can guarantee — exactly the kind of claim OD14 refused to assume for the
credentials header and instead read from source.

Read each harness's own error-formatting code (`node_modules` after `pnpm install`, or the
public source for a package not vendored here — never a live call) and answer one question:
**does the text the runner sees still contain the gateway's `code`, in a form
`parseGatewayErrorDetail` can find?** Write the answer into `open-designs.md` OD18, one entry per
harness, with the file/line evidence. A harness whose SDK strips the structure and keeps only a
human-readable message is a **fail**, and that is the finding — not a defect in the runner's
parser, which cannot recover what never arrived.

## Gap 2 — the agent service never surfaces `errorDetail` onto its stream

`AgentRunFailed.error_detail` reaches Python intact (confirmed by reading `wire.py` and
`streaming.py`: nothing between `result_from_wire` and the vercel adapter catches or rewraps the
exception). But `stream.py`'s `_error_parts` — the single function both
`agent_run_to_vercel_parts` and `agent_stream_to_vercel_stream` call from their terminal
`except Exception` handlers — reads only `getattr(error, "failure_code", None)` for the
`data-agent-error` part's `code` field. It never reads `error_detail`, so `retryable`,
`next_step` and `details` stop at the Python boundary even when the runner recovered them
correctly.

**The fix:** `_error_parts` also reads `getattr(error, "error_detail", None)` and, when present,
carries it whole as `errorDetail` on the `data-agent-error` part's `data`. `code` and `errorText`
stay as they are (unchanged shape for a caller reading only those two fields); `errorDetail` is
additive, mirroring how `errorDetail` is additive-and-optional on the runner's own
`AgentRunResult`. No wire-shape change on the Python→JS side — `errorDetail`'s field names
(`code`, `message`, `retryable`, `next_step`, `details`) are already the platform's
agent-actionable envelope (`api/AGENTS.md`), untouched here.

## Contracts

- **One shape.** `errorDetail` on the vercel stream is exactly `AgentErrorDetail`, byte-for-byte
  what the runner attached. No renamed fields, no flattening.
- **`error`/`errorText` never regresses.** A caller reading only the existing string field keeps
  working unchanged; `errorDetail` is purely additive.
- **A harness that cannot preserve the body is not silently degraded.** Its run still fails with
  `error` (the plain message), just without `errorDetail` — the same shape it has today. OD18
  records which harness that is, so a future change that assumes otherwise has something to
  contradict.
- **No new parsing in `gateway-error.ts`.** OD18 is a verification pass; the existing scan is
  already correct for every body that survives intact.

## Tests

- Unit (`services/runner`): a harness-shaped fixture per harness's confirmed format (Pi/Anthropic
  SDK's JSON-embedded shape; Codex's stripped shape) round-tripped through
  `parseGatewayErrorDetail`, for each of the five refusal codes. The Codex case asserts
  `undefined` — a passing assertion, not a skip, that documents the finding rather than merely
  stating it.
- Unit (`sdks/python`): `_error_parts` / the two vercel projection functions, given a mock
  `AgentRunFailed` carrying `error_detail`, emit a `data-agent-error` part whose `data.errorDetail`
  equals it; given a plain exception (no `error_detail`), the part carries no `errorDetail` key
  (not even `null`).
- Unit (`sdks/python`): each of the five refusal codes, wired end-to-end from a
  `result_from_wire`-shaped `{"ok": false, "error": ..., "errorDetail": {...}}` dict through
  `AgentRunFailed` to the vercel stream's `data-agent-error` part.

## Out of scope

- The local-agent fallback for a harness that fails OD18 (Codex) — a separate package, per OD14's
  same-shaped precedent.
- `request_connection` / the step-up interaction (WP26, WP19) — this package only makes the cause
  reach the caller; acting on it is the next package's job.
- Any change to the gateway's own refusal shape (`_map_domain_exception`) or to
  `parseGatewayErrorDetail`'s scan logic — both are already correct for what OD18 confirms
  survives.
