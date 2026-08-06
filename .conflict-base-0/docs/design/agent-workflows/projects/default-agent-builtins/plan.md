# Execution plan

Four pieces, in dependency order. Each one is reviewable alone, and all four landed together on
`fix/pi-default-builtins` as [PR #5597](https://github.com/Agenta-AI/agenta/pull/5597), for the
reason given in [Order and independence](#order-and-independence). The first piece fixes the
reported bug; the rest keep the result honest and legible.

## Piece 1: ship Pi's built-ins in the default template

This is the fix.

Files:

- A small neutral Pi-facts module in `sdks/python/agenta/sdk/agents/`: add
  `PI_DEFAULT_ACTIVE_BUILTINS`, a tuple of Pi's four default built-in names, named exactly like the
  TypeScript constant at `services/runner/src/engines/sandbox_agent/run-plan.ts:192`. Not in
  `agenta_builtins.py`: that module owns the `pi_agenta` harness's forced Agenta opinions, and Pi's
  native active set is not one. Reasoning in
  [design.md](design.md#the-claude-harness-warning).
- `sdks/python/agenta/sdk/utils/types.py:1429`: build the `tools` list from that constant as
  `{"type": "builtin", "name": name}` entries.
- `services/oss/tests/pytest/unit/agent/test_default_agent_template.py`: add the new assertion and
  narrow the existing authoring-extras assertions, as described in
  [testing.md](testing.md#tests-that-must-be-updated).
- `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py`: add the default-to-wire test.
- A shared golden fixture holding the four names, asserted from Python against the new constant and
  from TypeScript against `PI_DEFAULT_ACTIVE_BUILTINS`, as described in
  [testing.md](testing.md#pinning-the-two-copies-of-pis-default-built-in-list). Not a test that
  reads the TypeScript source.

Verification before moving on: `cd services && py-run-tests`, `cd sdks/python && py-run-tests`,
`cd api && py-run-tests`. The `api` suite is included because
`api/oss/tests/pytest/unit/tools/test_platform_handlers.py:237` computes its expectation from the
builder and should adapt without edits; if it does not, something else reads the default.

## Piece 2: stop the Claude harness warning firing on the default set

Files:

- `sdks/python/agenta/sdk/agents/adapters/harnesses.py:94`: stay silent only when the set is
  exactly the four defaults, and name the dropped tools in the message. Not a name-by-name filter:
  that would silence a deliberately authored subset such as `["bash"]`. Reasoning in
  [design.md](design.md#the-claude-harness-warning).
- `sdks/python/oss/tests/pytest/unit/agents/test_harness_adapters.py`: assert that the exact
  default set produces no warning, and that a subset (`["bash"]`), a superset
  (the four plus `grep`), and a non-default name each still warn.

This depends on piece 1 only for the shared constant. It should ship with piece 1 rather than
after it: piece 1 alone makes the warning fire on nearly every Claude run.

## Piece 3: correct what the author sees

Frontend only. Nothing here changes the wire.

Files, all under `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/`:

- `PiSettingsControl.tsx`: the same false claim appears three times, not once. The file header
  comment says "an absent entry means Pi uses its own defaults" (`:5`), the `onChange` prop comment
  says "undefined removes an empty tools field" as if that restored defaults (`:25`), and the help
  text says "empty leaves Pi's harness defaults" (`:111`). Correct all three: neither an empty list
  nor a removed field leaves Pi's defaults; both grant nothing.
- `agentTemplate/itemDescriptors.tsx:195`: label a built-in row from its top-level `name` when
  present, falling back to `type` for provider built-ins that carry no name.
- `web/packages/agenta-entity-ui/tests/unit/`: cover the label change.
- `web/packages/agenta-playground/tests/unit/agentRequest.test.ts`: add the overlay case where the
  base template already carries all four built-ins.

Run `pnpm lint-fix` inside `web` before committing.

## Piece 4: update the documentation that describes the default

The interface documentation states the default agent config field by field, and the build-an-agent
skill teaches the same shape to the builder agent. Both showed an empty tools list before this
change.

Files:

- `docs/design/agent-workflows/interfaces/public-edge/agent-config-schema.md:75`: the default
  config example. Note that this example is stale in other ways too (it shows the pre-migration
  flat shape and an older model), so scope the edit to the `tools` line rather than rewriting the
  block, or rewrite it fully as a separate change.
- `docs/design/agent-workflows/documentation/tools.md`: the built-in row and the grant-list
  section should say that the default template ships Pi's four defaults.
- `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:126`: the config-shape example
  bundled into the build-an-agent skill. Its drift test is
  `sdks/python/oss/tests/pytest/unit/agents/test_agenta_builtins_reference_files.py`.

## Order and independence

Piece 1 must land first; everything else refers to its constant or describes its result. Pieces 2,
3, and 4 are independent of each other and can be reviewed on separate branches. Piece 3 touches
only `web/`, so it conflicts with nothing.

They are separate review lanes, not separate releases. Pieces 1, 2, and 3 ship together. Piece 1
alone makes the Claude warning fire on nearly every Claude run (piece 2's problem) and leaves a
Tools section showing four rows all labelled "builtin" under a help text that actively misleads
(piece 3's problem). Piece 4 is documentation and can trail.

Piece 1 closes [#5590](https://github.com/Agenta-AI/agenta/issues/5590) for newly created agents
only. It does not repair existing agents, and it does not make an unattended write-capable run
complete. Say that on the issue rather than closing it flat.

## What this plan does not do

Agents saved before the fix keep an empty tools list and keep failing outside the playground. The
reasoning is in [design.md](design.md#repair-agents-already-saved). The per-agent workaround is one
edit in the Advanced section followed by a commit.
