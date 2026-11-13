# Vercel stream conformance — specs

> Closes the two Vercel data-stream protocol conformance bugs from the v3 assessment (F-3, F-4). Source:
> `big-agents-audit/big-agents-assessment-v3.md`. SDK-only; both live in
> `sdks/python/agenta/sdk/agents/adapters/vercel/`. Independent of the other worktrees.

## F-3 — Inbound parser silently drops part types (Med)

**Problem.** `_part_to_blocks` (`.../vercel/messages.py`) handles `text` / `file` / `tool-*` and falls
through to `return []` for everything else — `reasoning`, `data-*`, `error`, `source-url`, `step-start`
are dropped with **no log**. Outbound→inbound is lossy, which breaks round-trip fidelity against the
Vercel data-stream protocol.

**Fix.** Map the missing part kinds, or at minimum **preserve-and-forward** unknown parts rather than
silently dropping them (an unknown part should survive the round-trip, even if as an opaque/passthrough
block, and an unmapped kind should at least be observable — a debug log or a metric, never a silent drop).
Prefer explicit mapping for the known kinds the outbound side emits (`reasoning` especially, since the
stream layer emits reasoning frames — see `stream.py`), and passthrough for the genuinely unknown.

**Done when:** a message containing a `reasoning` (and the other currently-dropped kinds) survives
`_part_to_blocks` instead of vanishing; a round-trip golden asserts outbound→inbound is lossless for the
kinds the adapter emits; unknown kinds are preserved-or-logged, never silently dropped.

## F-4 — Mid-stream exception skips the finish frame (Low, Very-Low effort)

**Problem.** In the stream loop (`.../vercel/stream.py`), a graceful terminal-failure result correctly
emits no finish (tested, intentional). But a raw `except Exception` inside the loop does `yield error;
return` with **no `finally`**, so the `finish-step` / `finish` tail never runs. A consumer counting on a
finish frame (the AI SDK UI message stream requires every stream to terminate with `finish`) **hangs** on
an unexpected error.

**Fix.** Wrap the emit tail so the finish frame **always** fires — a `try/finally` around the stream body
so the `finish-step`/`finish` frames emit on every exit path, including the unexpected-exception path.
Keep the existing intentional no-finish behavior for graceful terminal-failure results (don't regress the
tested case) — this is specifically about the untested raw-exception path.

**Done when:** an unexpected exception mid-stream still emits the terminal `finish` frame (new test for the
raw-exception path); the existing graceful-terminal-failure test still passes unchanged.

## Non-goals
No redesign of the adapter; no change to the finish-reason enum mapping beyond what F-4 requires. These are
two contained protocol-conformance fixes in the Vercel adapter.
