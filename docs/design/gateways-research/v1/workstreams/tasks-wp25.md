# WP25 — tasks

Read [`specs-wp25.md`](specs-wp25.md) first. Branch from C2.

## Phase 0 — the harness error-body matrix, before any code

- [ ] `pnpm install` in `services/runner` so the pinned harness SDKs are readable source, not
      just version pins.
- [ ] Pi (`@earendil-works/pi-ai`): read `utils/error-body.js` and confirm it is wired into the
      OpenAI-shaped client (`api/openai-completions.js`); read the Anthropic-shaped client's
      dependency (`@anthropic-ai/sdk`'s `core/error.js` `APIError.makeMessage`) and confirm the
      `JSON.stringify(errorResponse)` fallback fires for a body with no top-level `message`.
- [ ] Claude Code (`@agentclientprotocol/claude-agent-acp`): read `dist/acp-agent.js`'s
      `is_error` branch and confirm it forwards the CLI's `result` string unmodified. Confirm
      the CLI itself (`@anthropic-ai/claude-agent-sdk`) is a compiled binary with no bundled
      source — record this as the boundary of what is verifiable, not as a pass.
- [ ] Codex (`@agentclientprotocol/codex-acp` + `@openai/codex`, not an npm dependency of this
      package): fetch `codex-rs/protocol/src/error.rs` at the tag matching the pinned npm
      version and read `UnexpectedResponseError::extract_error_message`. Confirm it keeps only
      `error.message`, discarding `code`/`type`.
- [ ] Write all three findings into `open-designs.md` OD18 with file/line evidence per harness —
      Codex's fail is a finding, not a defect to fix by parsing harder.
- [ ] Commit: "gateways(docs): close OD18 with the per-harness error-body matrix".

## Phase 1 — the marker: close Codex's gap on the gateway's side

Recording Codex's failure is not sufficient — WP19's step-up interaction is built on this
channel, and a refusal without a code cannot be acted on. The fix: since `error.message`
survives on every harness examined, including Codex, put a machine-readable marker inside it.

- [ ] `api/oss/src/apis/fastapi/gateways/utils.py` (shared by both proxies already, for
      `response_headers`): add `CODE_MARKER_OPEN`/`CODE_MARKER_CLOSE` and `with_code_marker
      (message, code)` HERE, not in `llms/proxy.py` — the MCP plane needs the identical helper
      and a second copy is the drift CU12 spent this wave proving is expensive.
- [ ] `api/oss/src/apis/fastapi/gateways/llms/proxy.py`: enumerate the actual five refusals by
      their exception (`SecretNotFoundError` → `secret_missing`, `SecretInvalidError` →
      `secret_invalid`, `LLMEndpointNotFoundError` → `endpoint_not_found`,
      `LLMModelNotAllowedError` → `model_not_allowed`, `GatewayEndpointInactiveError` →
      `endpoint_inactive`). While enumerating, confirm `SecretInvalidError` (the real "rejected
      credential") is actually mapped and actually caught — it was neither, before this task.
      Add both: a `_map_domain_exception` branch (409, `secret_invalid`) and the exception to
      `_DOMAIN_EXCEPTIONS`.
- [ ] Add a `marked` flag on `_openai_error` (default `True`), rendering
      `with_code_marker(message, code)` for every typed refusal. Pass `marked=False` for the
      `LLMUpstreamError`/`upstream_error` branch — D16 forbids injecting into the upstream's own
      forwarded detail.
- [ ] Unit (`api`): every typed code's rendered message ends with its marker; `upstream_error`'s
      never contains one; `SecretInvalidError` reaches the caller as `secret_invalid` rather than
      an unhandled 500 (parametrize the existing `_DENIAL_CASES` table rather than duplicating
      it).
- [ ] Commit: "gateways(llm-proxy): render a machine-readable code marker on every typed refusal,
      wire the missing SecretInvalidError mapping".

## Phase 1b — the same marker, the same audit, on the MCP plane

WP26 (an agent requesting a missing connection) needs this plane's version of the channel
specifically, and D35's second consequence is dead on Codex without it, same as the LLM case.

- [ ] `api/oss/src/apis/fastapi/gateways/mcps/proxy.py`: add a `marked` flag to `_protocol_error`
      (default `True`), rendering `with_code_marker(message, cause)` for every cause. Pass
      `marked=False` for the `MCPUpstreamError`/`upstream_error` branch — same D16 reasoning,
      same exclusion, this plane too.
- [ ] Run the SAME audit Phase 1 ran on the LLM plane: `grep -rn "raise [A-Z]"` across
      `core/gateways/mcps/service.py` and `registry.py`; confirm every raised exception has a
      branch in `_map_gateway_exception` AND is listed in `_MAPPED_EXCEPTIONS`. Report the
      result either way in OD18 — a clean audit is still worth recording, since the LLM side's
      wasn't.
- [ ] Unit (`api`): every mapped cause's rendered `message` ends with its marker (parametrize the
      existing per-cause table in `test_gateways_mcp_proxy.py`); `upstream_error`'s never does.
- [ ] Commit: "gateways(mcp-proxy): apply the shared code marker; audit finds no mapping gap".

## Phase 2 — the marker fallback in the runner, both planes

- [ ] `services/runner/src/gateway-error.ts`: add `CODE_MARKER_RE` matching
      `⟦agenta_code:([a-z_]+)⟧`, and `parseFromMarker` — matches the marker, strips it from the
      text for a clean `message`, returns `{code, message, retryable: false}` with no
      `next_step`/`details` (never backfilled from `NEXT_STEPS`).
- [ ] Restructure `parseGatewayErrorDetail` to try the existing body scan first
      (`parseFromBody`), then `parseFromMarker` as fallback. No change to the body scan itself.
- [ ] Add `secret_invalid` to `NEXT_STEPS` (used only on the body path, where `next_step` is
      populated from it).
- [ ] Unit (`tests/unit/gateway-error-harness-formats.test.ts`): per LLM refusal code, two cases
      — the Pi/Anthropic-SDK shape (marker riding inside the JSON-embedded body) recovering the
      full envelope via the body path with `message` UNCHANGED (marker included, since the body
      scan doesn't know to strip it); Codex's shape
      (`"unexpected status {n}: {message} ⟦agenta_code:{code}⟧"`) recovering `code` alone via
      the marker path, `message` marker-stripped, `next_step`/`details` asserted absent.
- [ ] Unit, same file: per MCP refusal cause, two more cases proving the marker is the ONLY
      channel on this plane (not merely a fallback) — the full JSON-RPC body embedded verbatim
      (`{"jsonrpc":"2.0","error":{"code":-32000,"message":"<marked>","data":{"cause":...}}}`,
      still only the marker recovers it, because `error.code` is a number there, not the LLM
      plane's string) and Codex's stripped-to-`message` shape.
- [ ] `pnpm test` and `pnpm run typecheck` in `services/runner`; confirm no new failures beyond
      the ~19 pre-existing ones on `origin/main`.
- [ ] Commit: "gateways(runner): recover code from the marker when the gateway body is gone".

## Phase 3 — close the agent-service gap

- [ ] `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`: `_error_parts` reads
      `getattr(error, "error_detail", None)` and, when truthy, adds it as `data["errorDetail"]`
      on the `data-agent-error` part. `code`/`errorText` unchanged.
- [ ] Confirm both call sites (`agent_run_to_vercel_parts`'s dev-only `except` branch and
      `agent_stream_to_vercel_stream`'s live `except` branch) pick it up for free, since both
      already call `_error_parts(..., error=exc)`.
- [ ] Unit: a mock `AgentRunFailed`-shaped exception with `error_detail` set produces a
      `data-agent-error` part carrying it; one without `error_detail` produces a part with no
      `errorDetail` key.
- [ ] Unit: each of the five refusal codes (the corrected mapping above, `secret_invalid` not
      `upstream_error`), built as a `result_from_wire`-shaped
      `{"ok": false, "error": ..., "errorDetail": {...}}` dict, raised through `AgentRunFailed`,
      reaches the vercel stream's `data-agent-error.data.errorDetail` with its `code` intact.
- [ ] `ruff format` && `ruff check --fix` in both `api` and `sdks/python`; run the SDK's unit
      tests (`cd sdks/python && py-run-tests`, or the narrower agents test path if the full
      suite is slow) and the API's gateway unit tests (`cd api && py-run-tests`, or
      `oss/tests/pytest/unit/gateways/`).
- [ ] Commit: "gateways(agent-service): surface errorDetail on the vercel stream".

## Definition of done

- OD18 is closed with per-harness evidence, including Codex's failure on the body path, and
  extended to record that the MCP plane never uses the body path at all (shape mismatch).
- Every refusal reaches the caller carrying its cause, proven per harness AND per plane — the
  body path where it survives (LLM only), the marker everywhere else (Codex on the LLM plane,
  every harness on the MCP plane).
- `SecretInvalidError` ("rejected credential") is an actual reachable refusal on the LLM plane,
  not an unhandled 500 — a gap that predated this package, closed as part of enumerating the
  refusals. The same audit on the MCP plane found no equivalent gap, reported either way.
- One `with_code_marker` implementation (`gateways/utils.py`), applied identically by both
  proxies — not two copies that can drift.
- `stream.py` carries `errorDetail` from a caught `AgentRunFailed` onto the vercel
  `data-agent-error` part, proven for all five refusal codes.
- No regression: `error`/`errorText` unchanged for every caller reading only those fields; the
  marker never appears in `upstream_error`'s forwarded detail, on either plane.
