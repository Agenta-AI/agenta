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
      `is_error` branch and confirm it forwards the CLI's `result` string unmodified (no
      reformatting on the bridge side). Confirm the CLI itself
      (`@anthropic-ai/claude-agent-sdk`) is a compiled binary with no bundled source — record
      this as the boundary of what is verifiable, not as a pass.
- [ ] Codex (`@agentclientprotocol/codex-acp` + `@openai/codex`, not an npm dependency of this
      package): fetch `codex-rs/protocol/src/error.rs` at the tag matching the pinned npm
      version and read `UnexpectedResponseError::extract_error_message`. Confirm whether it
      keeps the full body or only `error.message`.
- [ ] Write all three findings into `open-designs.md` OD18, closed, with file/line evidence per
      harness — a fail is a finding, not a defect to fix here.
- [ ] Commit: "gateways(docs): close OD18 with the per-harness error-body matrix".

## Phase 1 — pin the findings as runner tests

- [ ] `tests/unit/gateway-error-harness-formats.test.ts`: for each of the five refusals named in
      `launch-3.md` — missing credential (`secret_missing`), rejected credential
      (`upstream_error`, the upstream's own 401 once our secret reached it, D16 pass-through),
      unregistered target (`endpoint_not_found`), disallowed model (`model_not_allowed`),
      deactivated endpoint (`endpoint_inactive`) — build
      a fixture string in the Pi/Anthropic-SDK-confirmed shape (`JSON.stringify` of the full
      `{"error":{...}}` body, optionally prefixed with an SDK-style `"<n> <body>"` wrapper) and
      assert `parseGatewayErrorDetail` recovers `code`, `message`, `retryable`, `next_step` where
      defined.
- [ ] Same file: one fixture per refusal code in the Codex-confirmed stripped shape
      (`"unexpected status <n>: <message-only>"`, no braces) and assert
      `parseGatewayErrorDetail` returns `undefined` — the documented "cannot preserve it" case,
      not a skip.
- [ ] No changes to `gateway-error.ts` itself; the existing scan is already correct for what
      survives. If a fixture fails, the finding was wrong — fix OD18, not the parser.
- [ ] `pnpm test` and `pnpm run typecheck` in `services/runner`; confirm no new failures beyond
      the ~19 pre-existing ones on `origin/main`.

## Phase 2 — close the agent-service gap

- [ ] `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`: `_error_parts` reads
      `getattr(error, "error_detail", None)` and, when truthy, adds it as `data["errorDetail"]`
      on the `data-agent-error` part. `code`/`errorText` unchanged.
- [ ] Confirm both call sites (`agent_run_to_vercel_parts`'s dev-only `except` branch and
      `agent_stream_to_vercel_stream`'s live `except` branch) pick it up for free, since both
      already call `_error_parts(..., error=exc)`.
- [ ] Unit: a mock `AgentRunFailed`-shaped exception with `error_detail` set produces a
      `data-agent-error` part carrying it; one without `error_detail` produces a part with no
      `errorDetail` key.
- [ ] Unit: each of the five refusal codes, built as a `result_from_wire`-shaped
      `{"ok": false, "error": ..., "errorDetail": {...}}` dict, raised through
      `AgentRunFailed`, reaches the vercel stream's `data-agent-error.data.errorDetail` with its
      `code` intact.
- [ ] `ruff format` && `ruff check --fix`; run the SDK's unit tests
      (`cd sdks/python && py-run-tests`, or the narrower agents test path if the full suite is
      slow).
- [ ] Commit: "gateways(agent-service): surface errorDetail on the vercel stream".

## Definition of done

- OD18 is closed with per-harness evidence, including the one that fails.
- `parseGatewayErrorDetail` is unchanged; its correctness for the surviving bodies is now pinned
  by tests instead of assumed.
- `stream.py` carries `errorDetail` from a caught `AgentRunFailed` onto the vercel
  `data-agent-error` part, proven for all five refusal codes.
- No regression: `error`/`errorText` unchanged for every caller reading only those fields.
