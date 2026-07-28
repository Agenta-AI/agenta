---
name: agent-release-gate
description: >-
  Run the agent release gate — a portable, wire-level QA harness for the agent runtime.
  Drives the same product endpoint the playground drives and asserts on the SSE frame
  stream and real side effects, never on model prose, so it works against any deployment
  (cloud or self-hosted) from three env vars. Use before an agent-workflows release, or
  after changing the runner, the SDK agent adapters, the runner Docker images, or the
  agent service. Triggers: "run the release gate", "QA the agent runtime", "does the
  agent still work end to end", "pre-release agent QA".
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Agent release gate

Product-level sanity QA for the agent runtime, one layer below the playground UI. The question
is not "is every detail right" — it is "**if a user opens the product and does the obvious first
things, do they work?**" This is the gate a release passes before shipping.

Every check asserts on the **wire** (the SSE frame types the browser sees) and on **side effects**
(the file really persisted, the revision really incremented) — never on what the model says. That
makes it deployment-agnostic: point it at any stack and the assertions still hold.

## Run it

Set three environment variables for the deployment under test, then run the gate:

```bash
export AGENTA_BASE=https://your-stack.example.com   # deployment origin
export AGENTA_PROJECT_ID=...                         # target project
export AGENTA_API_KEY=...                            # project API key

uv run resources/qa_product.py --all --custom-slug <vault-slug>  # every cell, every journey
uv run resources/qa_product.py --cell P1                         # one cell
uv run resources/qa_product.py --cell C1 --only chat              # one journey
uv run resources/qa_product.py --cell C3 --only records --only sessions  # the sessions-storage journeys
uv run resources/qa_product.py --cell C3 --last-message-only      # minimal-history differential run
```

Paths are relative to this skill's directory. The deployment's vault must hold the provider keys
the cells use (Anthropic / OpenAI / OpenRouter). If the three env vars are unset the driver stops
immediately and names exactly what is missing; a legacy `--env-file <path>` fallback also exists.
`--all` includes cell P2 (a custom OpenAI-compatible provider), which needs a vault slug passed
via `--custom-slug`; the driver fails fast if it's missing. Cell S1 (the Codex subscription path)
additionally needs the subscription sidecar logged in on the target deployment — see
`resources/coverage.md` for what each cell requires.

**Reading the result.** Each journey prints `PASS`, `FAIL`, or `SKIP` with a one-line reason, and
a per-cell markdown table lands with the full JSON in `./qa-gate-runs/<timestamp>/` (override the
location with `AGENTA_QA_RUNS_DIR`). Runs are written to the current working directory, never into
the skill. `SKIP` is expected where a journey does not apply to a cell (for example `mcp` on any Pi
cell — user MCP is Claude-only). Any `FAIL` blocks the release until triaged.

## When results lie

The runtime **fails open**: a component can break, get logged, and the turn still succeeds with a
normal-looking answer. A green turn is therefore not proof on its own. Before trusting a pass,
read `resources/LESSONS.md` — every trap there produced a green test that proved nothing. The two
that bite hardest: a full-history client must replay conversation history byte-faithfully (tool
parts included) or every turn silently goes cold — a last-message-only client is exempt by design,
see LESSONS #1 — and re-run any prior blocker-level finding after a redeploy before believing it.

## Resources (read on demand)

- `resources/coverage.md` — the cells (harness × sandbox × auth) and journeys (chat, mount, tool,
  approve, deny, commit, warm, mcp, records, sessions, followup) with a one-line meaning for each.
- `resources/LESSONS.md` — the traps. Read before writing or trusting any agent QA test.
- `resources/qa_product.py` — the gate driver (cells × journeys).
- `resources/qa_probe.py` — a one-turn wire probe: `uv run resources/qa_probe.py` confirms the
  product path answers at all before running the full gate.
- `resources/qa_longctx.py` — optional long-context / Gmail / concurrent-session probes. Needs
  live Gmail and GitHub Composio connections in the target project; skip it otherwise.
- `resources/seeds/` — representative green `results.json` files kept as regression-seed references.

Release-night findings and the full evidence history are archived in
`docs/design/agent-workflows/projects/qa/` (findings.md, matrix.md, README.md).

## Sessions rework (v0.106) addendum

The gate above predates the sessions-storage rework (`feat/sessions-storage-rework`, v0.106.x) and
does not yet exercise its flag-gated paths — see `resources/coverage.md` for the exact list of
what is not covered.

**The four flags.** Parsing is NOT uniform across them — check the literal value, not just
whether the variable is set:

- `AGENTA_SESSIONS_RECONSTRUCT` (runner) — rebuilds prior turns from the durable record log for a
  minimal-history request. Accepts ONLY the literal string `"true"` (case-insensitive); `1`,
  `yes`, `on` silently do nothing (`reconstruct-history.ts` `reconstructEnabled`).
- `AGENTA_RECORDS_DURABLE` (runner) — stronger retry + drop-counting on record persistence. Same
  literal-`"true"`-only parsing (`sessions/persist.ts` `durableRecordsEnabled`).
- `NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY` (web) — sends only the trailing user message on a fresh
  turn instead of full history; a HITL resume still sends full history. Broader truthy parsing
  (`true`/`1`/`t`/`y`/`yes`/`on`/`enable`/`enabled`), unlike its runner counterpart. **Must be
  flipped together with `AGENTA_SESSIONS_RECONSTRUCT`** — nothing enforces the pairing at runtime,
  so web-on/runner-off silently loses all context on every cold turn (the client sends one
  message; the runner has no reconstruction to fall back on).
- `AGENTA_RECORDS_SMART_TRUNCATION` (API) — preserves record structure instead of dropping an
  oversized record body wholesale. Same broader truthy parsing as the web flag
  (`api/oss/src/utils/env.py` `SessionsRecordsConfig`).

**Differential QA, not verdict QA.** A flags-on run and a flags-off run against the same stack each
report their own PASS/FAIL and tell you nothing about each other. The method that actually finds
defects here: run the gate **twice against ONE flags-on stack**, changing only the client's history
mode (full history vs. last-message-only), and diff the message arrays the runner hands the model,
turn by turn. The defects live in the diff — a dropped tool part, a duplicated turn, turns
reconstructed in the wrong order — not in either run's verdict.

**Release QA plan.** The concrete plan for this release (target stack, flag matrix, division of
labor) is `docs/design/agent-workflows/projects/qa/release-2026-07-sessions-storage-rework.md`.

**Caution.** A green flags-off run says nothing about the flags-on path, and vice versa — they
exercise different code (server-side history reconstruction, client-side history truncation). Run
both before shipping a release decision; never extrapolate one to the other.
