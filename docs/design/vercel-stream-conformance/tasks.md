# Vercel stream conformance — tasks

> Companion to `specs.md`. One worktree (`feat/vercel-stream-conformance`). Two independent WPs in the
> SDK Vercel adapter. Effort: Low · Very Low.

- **WP1 — F-3: stop dropping inbound part types.** Effort: Low. Level: SDK.
  - `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py` — `_part_to_blocks` currently falls
    through to `return []` for `reasoning` / `data-*` / `error` / `source-url` / `step-start`. Map the
    known kinds the outbound side emits (esp. `reasoning`, which `stream.py` emits), and preserve-and-forward
    genuinely-unknown parts instead of silently dropping; make an unmapped kind observable (debug log or
    metric), never a silent drop.
  - Add a **round-trip golden** asserting outbound→inbound is lossless for the emitted kinds.

- **WP2 — F-4: finish frame always fires.** Effort: Very Low. Level: SDK.
  - `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py` — wrap the emit tail in `try/finally` so the
    `finish-step`/`finish` frames emit on every exit path, including the raw-`except Exception` path (today
    `yield error; return` skips the tail). Do NOT regress the intentional graceful-terminal-failure
    no-finish case (it's tested).
  - Add a test for the raw-exception path asserting the terminal `finish` frame is still emitted.

## Verify
- SDK: from `sdks/python/` run `ruff format` then `ruff check --fix`. Run the existing Vercel adapter
  tests plus your new ones: `cd sdks/python && uv run --no-sync python -m pytest oss/tests/pytest/unit/agents/adapters -q`
  (existing suites: `test_vercel_stream_finish_reason.py`, `test_vercel_stream_park.py`). Report REAL results.
- Do NOT commit. Do NOT deploy.

## Constraints
- **No audit/finding identifiers** (`F-3`, `F-4`, etc.) anywhere in code, tests, or comments — describe
  behavior plainly.
- One terse comment line max, or none.
- Match the adapter's existing style.
