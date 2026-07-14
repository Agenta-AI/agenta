# Contract-versioning implementation — build notes

Session: https://claude.ai/code/session_01GYo3UEfvsZpncagqb28Mbc
Date: 2026-06-24
Lane: `feat/agent-contract-versioning-docs` (PR #4829), stacked on `refactor/agent-harness-rename` (#4833).

This file records the judgment calls for the implementation slice of the (revised) contract-versioning
proposal. The README is the spec. Two pieces are in scope; the rest is deliberately deferred.

## Scope implemented

1. **Harness as slug + display name in the interface** (README §2 / author review).
2. **Issue 2** — bind the builtin URI `agenta:builtin:agent:v0` to the live `_agent` handler
   (architecture-followups.md #2).

## Explicitly deferred (POC, "we don't need version yet")

- `version` string on `/run`, the if/elif version dispatch, the `/health` `protocol` skew-guard read.
  These remain the documented (deferred) design in the README. Not implemented here.

## Decision: the minimal harness slug + name representation

The author asked for the harness in the **interface** to be a slug (mirroring
`agenta:builtin:agent:v0` from `interfaces.py`) plus a display name, not a bare enum string.

### What "the interface" is, and what stays bare

The harness appears in four places:

- **`AgentConfigSchema.harness`** (`sdks/python/agenta/sdk/utils/types.py`) — the JSON Schema the
  `/inspect` agent_config catalog type advertises and the playground renders. THIS is "the interface."
- **`AgentConfig` runtime parse + `RunSelection.harness`** (`agents/dtos.py`) — the stored/runtime value.
- **`HarnessType` enum** (`agents/dtos.py`) — the closed enum the runtime/wire use.
- **The wire `harness` field** (`wire.py` → `protocol.ts`) — the runtime SELECTOR the runner reads to
  pick the ACP agent (`run-plan.ts`: `harness === "pi_core" || "pi_agenta" ? "pi" : harness`).

The minimal representation gives the slug+name to the **interface only** and leaves the **stored/wire
value bare** (`pi_core` / `pi_agenta` / `claude`). Why bare-value-stays:

- The wire `harness` value is a runtime selector consumed verbatim by the runner and by FE
  `connectionUtils` (`allowedProviders("pi_core")`). Promoting it to a full slug would ripple into the
  runner agent-selection, the golden fixtures, both wire tests, `RunSelection`, and the FE read/write —
  a large change for what the doc frames as a preproduction identity restructuring. The README §2 itself
  says the harness *values* "stay as they are."
- Keeping the value bare means the `/run` wire shape DOES NOT change, so `protocol.ts` / `wire.py` /
  the golden fixtures are untouched (the scope's "if the wire harness field shape changes" condition is
  false). The wire-contract tests stay green unchanged.

### The representation

One SDK source of truth: a small registry mapping each `HarnessType` to a versioned **slug** and a
**display name**, in `agents/dtos.py` (next to `HarnessType`). The slug convention mirrors
`agenta:builtin:agent:v0`: `agenta:harness:<value>:v0`.

- `pi_core`   → slug `agenta:harness:pi_core:v0`,   name "Pi"
- `pi_agenta` → slug `agenta:harness:pi_agenta:v0`, name "Pi (Agenta)"
- `claude`    → slug `agenta:harness:claude:v0`,    name "Claude Code"

`AgentConfigSchema.harness` changes from `Literal[...]` to a `oneOf` of
`{const: <value>, title: <display name>, x-ag-slug: <slug>}` entries (one source: built from the
registry). The stored value is still the bare `const` string; the slug rides as `x-ag-slug` metadata and
the name as the option `title`. This is the JSON-Schema-native "enum of values, each with a display
title" — no parallel format invented.

The FE `EnumSelectControl` learns to read a `oneOf` of `{const, title}` (in addition to a flat `enum`),
so the harness dropdown shows the display names. It writes back the bare `const` value, so
`config.harness` and the wire are unchanged.

This is the minimal-complexity representation that satisfies #4829: it gives the harness a versioned slug
identity + display name in the interface, reuses the repo's slug grammar, and changes neither the wire
nor the runtime selector.

## Decision: issue 2 — bind the builtin URI without the import-ordering trap

`create_agent_app()` registers `_agent` via `ag.workflow(...)` with no URI, so it gets an auto
`user:custom:...` URI. Issue 2 wants it bound to `agenta:builtin:agent:v0` so `retrieve_handler` /
`retrieve_interface` for that URI return the live handler/interface.

### The import-ordering trap

`workflow.__init__` (running.py) calls `_retrieve_handler(self.uri)` for non-custom URIs. If the builtin
URI is passed before the interface is registered, the lookup can fail at import time. The fix passes the
URI through `ag.workflow(uri=...)` and ensures the SDK registers the agent interface (the SDK's
`agent_v0_interface`) for that URI BEFORE the handler constructor runs, so the non-custom-URI lookup
resolves. Verified against running.py's ordering.

## Codex review refinements (xhigh, read-only)

Codex reviewed both decisions. Verdict: Decision 1 mostly right; Decision 2 as first drafted was
unsafe. Folded in:

- **Keep parent `enum` AND add `oneOf` titles.** Do NOT drop the flat `enum`. The FE schema
  validator handles `enum` before `oneOf` and does not enforce `const`; keeping `enum` preserves
  every existing consumer while `oneOf` adds the display labels. So the harness field carries both
  `enum: [values]` and `oneOf: [{const,title,x-ag-harness-slug}]`.
- **Slug key name: `x-ag-harness-slug`**, not the generic `x-ag-slug` (specific to the harness).
- **Issue 2 — instrument BEFORE registering.** `workflow.__call__` only runs `auto_instrument`
  inside `_register_handler` when `self.handler is None`. Pre-registering the RAW `_agent` makes
  `__init__`'s `_retrieve_handler` set `self.handler` to the raw callable, so instrumentation is
  skipped. Fix: `instrumented = auto_instrument(_agent)`, register THAT under the builtin URI, then
  `ag.workflow(uri=..., schemas=AGENT_SCHEMAS, meta=...)(_agent)`. Mirrors chat.py, whose registry
  `chat_v0` is already instrumented.
- **Stale `CONFIGURATION_REGISTRY` agent entry.** Binding the URI makes `workflow.__init__` apply
  `CONFIGURATION_REGISTRY["agenta"]["builtin"]["agent"]["v0"]` as the default parameters when the
  caller passes none. That entry is a flat `{model, agents_md}`, not the `{"agent": ...}` shape with
  service defaults. Fixed it to `{"agent": build_agent_v0_default()}` (the shared SDK builder, one
  owner), so the SDK builtin config matches the interface default.
- **`register_interface` must REPLACE, not setdefault.** `INTERFACE_REGISTRY` already has
  `agent:v0` (the SDK minimal interface). To make `retrieve_interface(uri)` return what `/inspect`
  advertises (AGENT_SCHEMAS) in the agent-service process, the service explicitly OVERRIDES the
  registry entry under the builtin URI (an explicit set, not setdefault). This is a process-local
  override; it does NOT change the API process's catalog output (the API builds its catalog from the
  SDK `INTERFACE_REGISTRY` in its own process). Documented as such.
- **`register_handler` uses `setdefault`** — a second `create_agent_app()` call in the same process
  won't replace the handler. Benign (the instrumented handler is identical), but tests that rebuild
  the app are written to tolerate it.

## Tests

- Wire contract (both sides) stay green unchanged (wire harness value is bare).
- New issue-2 acceptance tests (architecture-followups §2 acceptance criteria).
- New harness-slug tests (registry + schema oneOf shape + FE EnumSelectControl oneOf reading).
- ruff format + check; pnpm lint-fix; pnpm test + typecheck in services/agent.
