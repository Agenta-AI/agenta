# How this is tested

> **Superseded.** Built-in tools left the agent config entirely. This file is a dated record of
> the 0.107.0 change; read [addendum-always-active.md](addendum-always-active.md) for what is true
> now.

All targets below are existing test suites in this repository. Run them with the commands in
[docs/designs/testing/README.md](../../../../designs/testing/README.md): `cd services && py-run-tests`,
`cd sdks/python && py-run-tests`, `cd api && py-run-tests`, and `pnpm test` inside
`services/runner`.

## The test that would have caught this

Nothing in the repository drives the shipped default template all the way to a `/run` body. The
Python tests check what the default contains
(`services/oss/tests/pytest/unit/agent/test_default_agent_template.py`), and the runner tests check
what the wire field means
(`services/runner/tests/unit/sandbox-agent-run-plan.test.ts:205`, which already pins that `[]` and
an omitted key differ). Both suites were green while every agent shipped with no tools, because
neither one crosses the boundary.

Add the crossing test to
`sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py`, which already owns the
"what actually goes on the wire" question:

```python
def test_default_template_grants_pi_default_builtins_on_the_wire():
    """A default-derived agent must reach the runner with Pi's built-ins granted.

    The runner reads `tools: []` as "grant nothing" and deletes every built-in from Pi's active
    set, so an empty list here means a saved agent has no read, bash, edit or write anywhere
    outside the playground (issue #5590).
    """
    template = AgentTemplate.from_params({"agent": build_agent_v0_default()})
    resolved = resolve_tools_offline(template.tools)
    payload = request_to_wire(... PiAgentTemplate(builtin_names=resolved.builtin_names, ...) ...)

    assert payload["tools"] == ["read", "bash", "edit", "write"]
```

Two properties make this the right test. It starts from the shipped default rather than a
hand-written template, so it fails if anyone empties the default again. And it asserts on the wire
payload rather than on the template, so it fails if a future change to `wire_tools`, the resolver,
or the harness adapter drops built-ins on the way.

The tool resolution step needs no network. `ToolResolver.resolve`
(`sdks/python/agenta/sdk/agents/tools/resolver.py:113`) derives `builtin_names` by filtering for
`BuiltinToolConfig`, and the default template has no gateway or reference tools to resolve.

Two cautions on the sketch above, which is pseudocode. `resolve_tools_offline` does not exist; the
test has to build the resolution step out of what does. And the middle of the chain must be the
real one. Constructing `PiAgentTemplate(builtin_names=...)` by hand skips
`PiHarness._to_harness_config` (`harnesses.py:75`), which is the layer that copies `builtin_names`
onto the harness template. Skipping it removes one of the two properties the test is for. Go
through the harness adapter, and only fall back to hand-filtering the configs if the suite cannot
build a `SessionConfig`.

## Tests that must be updated

`services/oss/tests/pytest/unit/agent/test_default_agent_template.py:68` and `:74` assert
`inspect_default["tools"] == []` and `builtin_default["tools"] == []`. These are the only
assertions in the repository that break.

They should not simply be flipped to the new list. The test they sit in is
`test_authoring_extras_absent_from_every_published_default`, whose point is that the playground
build kit's extras never leak into the published default. Pi's built-ins are not authoring extras,
so they belong in a separate assertion with its own reason:

```python
def test_published_default_grants_pi_default_builtins():
    """A new agent must be able to read, run shell commands, and edit and write files wherever it
    runs, not only in the playground (issue #5590). The runner reads an empty tools list as
    "grant nothing"."""
    expected = [{"type": "builtin", "name": name} for name in PI_DEFAULT_ACTIVE_BUILTINS]
    assert _inspect_agent_default()["tools"] == expected
    assert _builtin_agent_default()["tools"] == expected
```

Leave `test_authoring_extras_absent_from_every_published_default` asserting the things it was
written for: no platform ops, no authoring skill, no elevated sandbox permissions. Change its
`tools` assertions to check that no `platform` or embed entry is present, rather than that the
list is empty.

## Pinning the two copies of Pi's default built-in list

The design introduces a Python constant for Pi's four default built-ins, and
`services/runner/src/engines/sandbox_agent/run-plan.ts:192` already holds the same list as
`PI_DEFAULT_ACTIVE_BUILTINS`. Two copies in two languages drift.

Pin them with a shared fixture asserted from both sides, the way `permission_decisions.json`
already is: a small golden under `sdks/python/oss/tests/pytest/unit/agents/golden/` holding the
four names, read by a Python test against the new constant and by a runner test against
`PI_DEFAULT_ACTIVE_BUILTINS`. Neither language owns the list; both are implementations of one
pinned contract.

An earlier draft proposed a Python test that regexes the array literal out of `run-plan.ts`. It is
rejected. It binds a Python unit test to TypeScript formatting and to a file path, so a
reformat or a move breaks a test that has nothing to do with either, and the failure names the
wrong cause. The extra machinery of a fourth golden file is small next to that.

Both sides run in CI on either change: `.github/workflows/12-check-unit-tests.yml` triggers on
both `sdks/python/**` and `services/**`, so a `run-plan.ts` edit runs the SDK job that holds the
Python half of the pin.

## Runner tests

No runner behavior changes, so no runner test changes. Two existing tests should be confirmed
still green rather than edited, because they pin the semantics this design deliberately does not
touch:

- `services/runner/tests/unit/sandbox-agent-run-plan.test.ts:205`, "distinguishes omitted tools
  from an explicit empty grant set".
- `services/runner/tests/unit/builtin-grant-list.test.ts`, the regression pin for the grant list
  going dead in commit `0e71bd0f7a`.

One addition is worth making while the area is open. `sandbox-agent-run-plan.test.ts` has no case
for the exact grant list the platform now sends. Add one asserting that
`tools: ["read", "bash", "edit", "write"]` under a blanket `allow` policy yields those four grants
and leaves `builtinGatingActive` false, which is the fast path the choice of set was made to
preserve, and that the same grant list under `allow_reads` turns gating on.

## Frontend tests

The two frontend changes in scope are the picker's help text and the built-in row label.

The row label has a natural home in
`web/packages/agenta-entity-ui/tests/unit/`, which already uses
`{type: "builtin", name: "read"}` as a fixture in `toolPermission.test.ts:128`. Assert that
`describeTool({type: "builtin", name: "read"})` returns the name `read` rather than `builtin`, and
that a provider built-in with no `name` still falls back to its `type`.

The help text is copy and needs no unit test.

Confirm `web/packages/agenta-playground/tests/unit/agentRequest.test.ts` stays green. Its overlay
cases (`:301` onward) exercise `withBuildKitOverlay`, and the identity merge is the mechanism that
keeps the overlay from duplicating the default's `read` and `bash`. Add a case where the base
template already carries all four built-ins and assert the merged list contains each name exactly
once, since that is the specific interaction this change creates.

## What the crossing test still does not cover

The crossing test proves builder-to-wire. The bug's actual path is longer: builder → the API
catalog's materialized `parameters` → the frontend factory → the committed revision → a run. Every
link in that second half is untested, and a break in any of them reproduces the same symptom.

Two of them are cheap to close and worth adding.

- **The catalog materializes the tools.** Assert that the templates endpoint's
  `template.data.parameters.agent.tools` carries the four entries, against
  `_build_template_data` (`api/oss/src/resources/workflows/catalog.py:106`). This is the step that
  hoists an object default out of the JSON Schema, and it drops non-primitive defaults from the
  schema afterwards, so it is not obviously a pass-through.
- **The factory copies them into a new agent.** Assert that
  `createEphemeralAppFromTemplate` (`web/packages/agenta-entities/src/workflow/state/appUtils.ts:134`)
  preserves `parameters.agent.tools` for a Pi template, including when the last-used-harness
  preference is applied (`agentCreationPrefs.ts:32`), which rewrites `harness.kind` and must leave
  `tools` alone.

The remaining links (commit, then invoke the committed revision) are the manual checks below.

## Manual verification

The unit tests cannot show that a real Pi agent regains its tools. Two checks against a running
stack close that gap.

1. Create a new agent from the default and commit it without editing anything. Confirm its saved
   revision's `parameters.agent.tools` holds the four built-in entries, and that the Tools section
   lists them by name.

   **Done, 2026-07-30.** Two checks against a running stack, both passing. The agent service's
   `/inspect` returns the four entries as the schema default the playground pre-fills from. And
   `GET /workflows/catalog/templates/` returns them under `data.parameters` for
   `agenta:builtin:agent:v0`, which is the source `createAppFromTemplate` prefers when it mints a
   new agent (`web/packages/agenta-entities/src/workflow/api/createFromTemplate.ts:185`). So the
   value a new agent is created from carries the four tools. The UI listing was not checked by
   hand; `itemDescriptors` unit tests cover the row labels.
2. Run that committed revision outside the playground, through a schedule or a direct invoke of
   the committed revision. Ask it to read a file. It should read the file rather than report that
   it has no tools. Then ask it to run a shell command and confirm the approval behavior described
   in [design.md](design.md) and [open-questions.md](open-questions.md), rather than a silent
   "no tools available" answer.

The `agent-release-gate` skill drives the same product endpoint at the wire level and asserts on
the frame stream, which is the right harness for check 2, but it needs a fix first. Both of its
seeds hand-write `"tools": []` into the agent template they commit
(`.agents/skills/agent-release-gate/resources/qa_probe.py:82` and
`resources/qa_product.py:752`). Run as-is, the gate would keep exercising the old empty-list shape
and would report green on exactly the configuration this change exists to replace. Update both
seeds to the shipped default before using the gate as evidence.
