# Contract versioning — implementation status

Status: LANDED (2026-06-24) — code + tests + docs done; on the GitButler lane
`feat/agent-contract-versioning-docs` (PR #4829), stacked on `refactor/agent-harness-rename`
(#4833) for human review (NOT merged to big-agents).

The README is the (revised) spec — a preproduction POC. This implementation slice does the
identity/slug restructuring + architecture-followups issue 2, and DEFERS the version-dispatch
machinery exactly as the README documents.

## What landed

### 1. Harness as a slug + display name in the interface

- One SDK source of truth: `HARNESS_IDENTITIES` (a `HarnessIdentity` list) in
  `sdks/python/agenta/sdk/agents/dtos.py`, mapping each `HarnessType` to a versioned slug
  (`agenta:harness:<value>:v0`, the repo's `agenta:...:v0` grammar mirroring
  `agenta:builtin:agent:v0`) and a display name (`Pi` / `Pi (Agenta)` / `Claude Code`).
- `AgentConfigSchema.harness` (`sdks/python/agenta/sdk/utils/types.py`) is now a `str` field whose
  JSON Schema carries BOTH a flat `enum` (back-compat for `schema.enum` consumers) AND a `oneOf`
  of `{const, title, x-ag-harness-slug}` built from `HARNESS_IDENTITIES`.
- FE `EnumSelectControl` (`web/packages/agenta-entity-ui/.../EnumSelectControl.tsx`) reads a `oneOf`
  of `{const, title}` for option labels (preferring it over the flat `enum`), still writing the
  bare `const` value back.
- The **stored/wire/runtime harness value stays the bare string** (`pi_core` / `pi_agenta` /
  `claude`): the runner reads it as the agent selector and FE connection gating keys off it, so
  `protocol.ts` / `wire.py` / the golden fixtures / both wire-contract tests are UNCHANGED. The
  slug+name is interface-only.

Minimal-complexity rationale (and Codex's review) are in `build-notes.md`.

### 2. Issue 2 — bind the builtin URI to the live handler

- `create_agent_app()` (`services/oss/src/agent/app.py`) now binds the live handler to
  `agenta:builtin:agent:v0`:
  1. `register_handler(auto_instrument(_agent), uri=...)` — instrument BEFORE registering, so the
     bound handler keeps tracing (mirrors chat.py, whose registry handler is pre-instrumented).
  2. `register_interface(...)` — a new helper in `engines/running/utils.py` that REPLACES (not
     setdefault) the SDK's minimal `agent_v0_interface` seed for the URI, so
     `retrieve_interface(uri)` returns the same schemas `/inspect` advertises. Process-local to the
     agent service.
  3. `ag.workflow(uri="agenta:builtin:agent:v0", schemas=AGENT_SCHEMAS, meta=...)(_agent)`.
- Fixed the stale `CONFIGURATION_REGISTRY` agent entry (`engines/running/utils.py`): it was a flat
  `{model, agents_md}`; now `{"agent": build_agent_v0_default()}`, the canonical shape via the
  shared builder, so a URI-dispatched run with no parameters gets the interface default.

The import-ordering trap (`workflow.__init__` calls `_retrieve_handler` for non-custom URIs) is
avoided by registering the instrumented handler first; the binding mechanics + Codex's three
prioritized corrections are in `build-notes.md`.

## Deferred (as the README documents — POC, "we don't need version yet")

- The `version` string on `/run`, the if/elif version dispatch, and the `/health` `protocol`
  skew-guard read. Left as the documented (deferred) design in the README.

## Tests (all green)

- SDK unit: 945 (incl. 5 new `test_harness_identity.py`).
- Wire contract: Python 20 (`test_wire_contract.py`, unchanged) + TS 160 (`pnpm test`), typecheck
  clean — the wire is unchanged.
- Service agent unit: 38 (incl. 4 new `test_builtin_uri_binding.py`).
- FE: entity-ui 23 (incl. 5 new `enumSelectControl.test.ts` + 18 connectionUtils), playground 26.
- ruff format + check clean; FE prettier clean.

## Docs synced

- `documentation/`: `ground-truth.md` (binding + slug note, replacing the stale "not registered"),
  `protocol.md` (wire harness is bare; interface dresses it), and (no change needed)
  `ports-and-adapters.md` / `runner-to-harness.md` (the runner selector is unchanged).
- `interfaces/`: `public-edge/agent-config-schema.md` (harness slug+name section),
  `public-edge/workflow-inspect.md` (binding in Owned by + Watch),
  `in-service/agent-service-handler.md` (app-build binding section),
  `in-service/neutral-runtime-dtos.md` (`HARNESS_IDENTITIES`), and the `interfaces/README.md` index
  rows (new test files).
- Left `interfaces/architecture-followups.md` (another session's untracked file) untouched; issue 2
  resolution is recorded here instead.

## GitButler

Stacked `feat/agent-contract-versioning-docs` on `refactor/agent-harness-rename` (#4833) so the
code edits depend on A3's renamed files. Staged only this project's + the implemented files; did
NOT sweep the unassigned tree files (`.husky/*`, `architecture-followups.md`, the coordination
board). NOT merged to big-agents.
