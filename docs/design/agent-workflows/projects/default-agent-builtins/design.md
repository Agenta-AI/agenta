# What we change and why

> **Superseded.** Built-in tools left the agent config entirely. This file is a dated record of
> the 0.107.0 change; read [addendum-always-active.md](addendum-always-active.md) for what is true
> now.

## The change

`build_agent_v0_default()` in `sdks/python/agenta/sdk/utils/types.py:1412` stops emitting an
empty tool list. It emits Pi's four default built-ins in the typed form the schema describes:

```python
"tools": [
    {"type": "builtin", "name": "read"},
    {"type": "builtin", "name": "bash"},
    {"type": "builtin", "name": "edit"},
    {"type": "builtin", "name": "write"},
],
```

Everything downstream already handles this. The value validates against the strict
`AgentTemplateSchema` (`types.py:1228`), `AgentTemplate.from_params` parses it into four
`BuiltinToolConfig` entries, `ToolResolver.resolve` turns them into
`builtin_names = ["read", "bash", "edit", "write"]`, and `PiAgentTemplate.wire_tools()` puts those
four strings on the `/run` wire. The runner grants them and permission gating proceeds exactly as
it does today.

Three changes support it, each described in its own section below. The built-in picker's help text
is corrected, because it currently tells the author the opposite of what happens. Each built-in row
in the Tools list shows its own name instead of the word "builtin". And the Claude harness stops
logging a warning for the default set, so the warning keeps meaning something.

## Which built-ins, and why those four

Pi's own default active set is `read`, `bash`, `edit`, `write`
(`PI_DEFAULT_ACTIVE_BUILTINS` at `services/runner/src/engines/sandbox_agent/run-plan.ts:192`).
The default template ships exactly that set.

Three sets were on the table.

**All seven** (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`). Rejected. The three extra
tools are search and listing conveniences that `bash` already covers, and shipping a set wider
than Pi's own default means every default agent's grant list differs from
`PI_DEFAULT_ACTIVE_BUILTINS`. That difference forces `computeBuiltinGatingActive`
(`run-plan.ts:233`) to keep the gating relay on even for an author who has set the permission mode
to `allow`, adding a round trip per tool call for no benefit. An author who wants `grep` can add
it.

**Only `read` and `bash`**, matching `AGENTA_FORCED_TOOLS`. Rejected. This is the set the
playground overlay grants, so it is the smallest set that closes the reported gap in the strict
sense. It is the wrong set to standardize on. The reason the playground has only these two is that
they are what a skill needs (`read` opens `SKILL.md`, `bash` runs its helper scripts), not a
judgment about what an agent needs. Shipping this set would leave a new agent unable to edit or
write a file except by shell redirection, which is a worse tool for the job and produces worse
diffs. It would also leave the platform default permanently out of step with Pi's default, which
is the confusion this bug is made of.

**Pi's four defaults.** Chosen. Two reasons. It is the set a user of Pi expects, so the platform
stops silently subsetting the harness. And it is the set that makes the grant list a no-op
relative to Pi's own behavior, which means `sameStringSet(builtinGrants, PI_DEFAULT_ACTIVE_BUILTINS)`
in `computeBuiltinGatingActive` returns true and an all-`allow` agent keeps the fast path with no
relay round trips.

The fast path has a cost the first draft did not name. When `computeBuiltinGatingActive`
(`run-plan.ts:233`) returns false, the runner never sets `AGENTA_AGENT_BUILTIN_GATING`
(`pi-assets.ts:369`), so the extension's inertness guard skips `registerBuiltinGating`
(`agenta.ts:373`) and `replaceActiveBuiltinTools` never runs. The four built-ins are then active
because *Pi* activates them, not because the runner enforced the grant list. Today those two sets
are identical, so the outcome is correct. If a future Pi release adds a fifth tool to its own
default active set, an agent under a blanket `allow` policy would get that tool even though its
saved grant list names exactly four. Choosing Pi's four defaults is what moves the shipped default
onto that unenforced path: today's `tools: []` is not equal to Pi's defaults, so gating is always
on.

The honest fix is a runner change outside this project: separate "shape the active tool set" from
"gate each call", so an explicit grant list is always applied and only the approval relay takes the
fast path. That belongs to the pi-builtin-gating design, which owns
`computeBuiltinGatingActive`. Recorded in [open-questions.md](open-questions.md); it does not block
this change, because the two sets are equal in the pinned Pi version and the cross-language
constant pin in [testing.md](testing.md) is what would catch them diverging.

The four are not equally powerful, and the permission model is what separates them. Under the
shipped default permission mode `allow_reads`, `read` is marked read-only in the identity table
(`services/runner/src/permission-plan.ts:40`) and runs without asking. `bash`, `edit`, and `write`
are not read-only and raise an approval on every call. Granting all four does not make a new agent
able to run shell commands unattended.

## What `read` can reach on the local sandbox

`read` runs without an approval, and on the shipped default sandbox that is a larger capability
than "read-only" suggests. Three facts stack.

The default sandbox is `local` (`_DEFAULT_SANDBOX` at `types.py:1071`). A `local` run spawns
`sandbox-agent` on the runner host itself (`services/runner/src/engines/sandbox_agent/provider.ts:148`),
and the platform already states plainly that this is "unconfined host bash and not a tenant
boundary" (`services/oss/src/agent/config.py:60`). Pi's `read` takes "a path to the file to read
(relative or absolute)" and resolves it with `resolvePath(filePath, cwd)`
(`path-utils.js`, `resolveToCwd`), which returns an absolute path unchanged. There is no cwd jail.
So on a `local` sandbox, `read` under `allow_reads` is an approval-free read of any file the runner
process can open.

Two things bound this, and neither removes it.

It is not a new capability. The playground overlay already forces `read` and `bash`
(`AGENTA_FORCED_TOOLS`), and the playground's default sandbox is also `local`, so an author can do
this interactively today. What this change adds is the *unattended* and *non-playground* version:
a saved agent invoked from a schedule or the API now reads host files with nobody approving.

It is deployment-controlled. `local` is only reachable where it is enabled, and
`AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` gates it. But unset defaults to `["local"]`
(`sdks/python/agenta/sdk/agents/sandbox_providers.py:30`), so every default deployment has it on,
and the platform's own mitigation for multi-tenant use is to drop `local` from the enabled set.

The conclusion is not to drop `read` from the default. An agent without `read` cannot do the job,
and `edit` and `write` are gated the same way `bash` is. The conclusion is that this change should
not ship into a shared deployment that still enables `local`, and that the design cannot describe
`read` as harmless just because it is classified read-only. Recorded as a pre-ship condition in
[status.md](status.md) and as an open question in [open-questions.md](open-questions.md); the
durable fixes (confine built-in filesystem operations to the run cwd, or stop enabling `local` by
default) are runner and deployment work, not template work.

## What this fixes, and what the reporter will still hit

This change makes the tools exist. It does not change whether they are allowed to run, and for the
scenario in [#5590](https://github.com/Agenta-AI/agenta/issues/5590) that distinction decides how
far the run gets.

The reporter runs a saved agent from a schedule and asks it to change directory, source an env
file, and run a Python script. Every one of those steps is `bash`.

After this change, that run reaches the model with `read`, `bash`, `edit`, and `write` in its tool
list. The model calls `read` and it works, because `read` is marked read-only
(`services/runner/src/permission-plan.ts:41`) and the default permission mode `allow_reads` allows
read-only tools. The model then calls `bash`. Under `allow_reads`, `bash` resolves to `ask`
(`permission-plan.ts:256`), no stored decision exists, and `decide()` returns `pendingApproval`
(`permission-plan.ts:155`).

A pending approval on an unattended run does not wait. It ends the turn.
`pauseUserApproval` (`services/runner/src/engines/sandbox_agent/acp-interactions.ts:176`) emits an
`interaction_request`, writes a durable interaction record, and calls `onPause()`, which destroys
the ACP session (`services/runner/src/engines/sandbox_agent/pause.ts:33`). The turn ends with
`stopReason: "paused"` and the `bash` call settled as not executed
(`services/runner/src/engines/sandbox_agent/run-turn.ts:793`). The keep-alive path that parks a
sandbox and waits for a human requires a platform session id
(`services/runner/src/server.ts:372`), and the schedule dispatcher sends none
(`api/oss/src/tasks/asyncio/triggers/dispatcher.py:309`).

So the reporter's observable outcome changes from "the agent says it has no tools" to "the agent
reads files, then stops at the first shell command". In the production detached dispatch path the
schedule's delivery row records `202 dispatched` and counts as a success either way
(`dispatcher.py:324`), so neither outcome is visible without opening the trace.

This is the permission model working as designed. `allow_reads` means writes ask, and nobody is
there to answer. The author's supported lever today is to set the agent's permission mode to
`allow`, or to add an explicit allow rule for `Bash`, either of which makes the scheduled run
complete.

Two things follow. First, this change is still the right change and still necessary: an agent with
no tools cannot be fixed by any permission setting, and an agent whose tools ask for approval can.
Second, it is not sufficient for the reporter's scenario on its own. Whether the platform should
do anything more, and what, is the first entry in [open-questions.md](open-questions.md).
[#5562](https://github.com/Agenta-AI/agenta/issues/5562), whose title asks for automations to have
sessions, is a report of that second half.

## What each consumer of the default sees

`build_agent_v0_default()` has three production call sites and they behave differently enough to
list.

**`services/oss/src/agent/schemas.py:41`, the agent service `/inspect` schema.** The value is the
`default` on `parameters.agent`. The workflow catalog hoists object defaults out of the schema and
into a materialized `parameters` block (`api/oss/src/resources/workflows/catalog.py:104`), and the
frontend's create-agent factory copies that block into the new agent
(`web/packages/agenta-entities/src/workflow/state/appUtils.ts:181`). This is the path that fixes
the reported bug: a newly created agent's saved revision now contains the four entries.

**`sdks/python/agenta/sdk/engines/running/interfaces.py:537`, the SDK built-in interface
`agenta:builtin:agent:v0`.** Same role, different publisher. It is pinned equal to the service
value by `services/oss/tests/pytest/unit/agent/test_default_agent_template.py:35`, so it changes
with the builder and stays equal.

**`sdks/python/agenta/sdk/engines/running/utils.py:288`, the built-in's fallback parameters.**
This is the value a run gets when it binds `agenta:builtin:agent:v0` and supplies no parameters at
all, and it is a live path, not a dead one. `retrieve_configuration` (`utils.py:526`) reads this
registry, `seed_empty_parameters_from_configuration` (`utils.py:534`) calls it, and the resolver
middleware calls that on every invoke (`sdks/python/agenta/sdk/middlewares/running/resolver.py:571`
and again after reference hydration at `:596`). The workflow decorator reads the same registry at
registration time (`sdks/python/agenta/sdk/decorators/running.py:240`). Two existing tests drive
it: `sdks/python/oss/tests/pytest/unit/test_workflow_shapes_running.py:234`
(`test_inline_agent_revision_without_parameters_uses_default_template`) and
`api/oss/tests/pytest/unit/tools/test_platform_handlers.py:237`
(`test_test_run_parameters_less_agent_revision_succeeds_with_resolver_backed_child`).

So the blast radius is wider than "agents created in the playground". An API or SDK caller that
invokes a revision bound to `agenta:builtin:agent:v0` with empty parameters also starts granting
Pi's four built-ins after this change. That is the intended behavior and it is consistent with the
rest of the change, but it must be stated rather than assumed inert. Both tests compute their
expectation from the builder, so neither needs editing.

Two copies of the default do not go through the builder and are worth naming so a reader does not
assume they moved.

`services/oss/src/agent/config.py:106` supplies `tools: []` as the request-time fallback for a
request that carries no agent template at all (threaded through
`services/oss/src/agent/app.py:58` into `AgentTemplate.from_params`). This path is reached only by
a caller that posts an agent invocation with no `parameters.agent`, which the platform does not
do. Leave it alone in this change. Aligning it is a separate cleanup with its own risk, and it is
listed in [open-questions.md](open-questions.md).

`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:126` holds a documentation copy of the
config shape inside the build-an-agent skill, and its example shows `"tools": []`. That example
teaches the builder agent what a config looks like, so it should show the new default. It is a
text change with a drift test already in place
(`sdks/python/oss/tests/pytest/unit/agents/test_agenta_builtins_reference_files.py`).

## The playground overlay keeps its two built-in entries

`build_agent_template_overlay()` (`api/oss/src/core/workflows/build_kit.py:75`) prepends
`{"type": "builtin", "name": "read"}` and `{"type": "builtin", "name": "bash"}` from
`AGENTA_FORCED_TOOLS`. Once the default template carries all four, those two entries are
redundant for a default agent.

They stay.

The overlay's merge is safe with them. `identityMerge` in
`web/packages/agenta-playground/src/state/execution/buildKitOverlay.ts:65` keys a tool entry by
`platform:<op>`, then `workflow:<slug>`, then `name:<name>` (`buildKitOverlay.ts:47`). The
default's `{"type": "builtin", "name": "read"}` and the overlay's identical entry both key to
`name:read`, so the overlay replaces the base entry in its existing position. There is no
duplicate and no reordering. The merged list is byte-identical to the base list for those two
entries.

The reason to keep them is that they are not there to repair the default. They are there because
the build kit ships a skill, and the playground must guarantee the skill is loadable regardless of
what the author's template says. An author who deliberately deselects `read` still needs it while
authoring, because otherwise the build-an-agent skill is announced in the system prompt and cannot
be opened. Removing the entries would make that guarantee depend on the default template, and the
default template is a value the author is free to edit. The comment above `AGENTA_FORCED_TOOLS`
(`agenta_builtins.py:58`) already states this as the reason they exist.

The cost of keeping them is one line of redundancy in a value that is already pinned by a test
(`api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py:66`). The cost of removing them
is a class of bug that only appears for an author who edited their tools, which is exactly the
author least likely to be testing the build kit.

The same reasoning applies to `force_tools()` on the `pi_agenta` harness
(`sdks/python/agenta/sdk/agents/adapters/harnesses.py:141`). It stays.

## The Claude harness warning

`ClaudeHarness._to_harness_config` (`sdks/python/agenta/sdk/agents/adapters/harnesses.py:94`)
logs a warning whenever `builtin_names` is non-empty:

```python
if config.builtin_names:
    log.warning(
        "ClaudeHarness ignores %d built-in tool(s); built-ins are a Pi concept",
        len(config.builtin_names),
    )
```

Today this fires almost never. After the change it fires on every Claude run whose template came
from the default, which is most of them. A warning that fires on the normal path is noise, and
noise is how a real warning gets missed.

Four options were considered.

**Leave it.** Rejected. It would fire on nearly every Claude run and say nothing actionable.

**Delete it.** Rejected. It is the only signal that an author who switched a configured Pi agent
to Claude has silently lost tools they chose.

**Downgrade to debug.** Rejected for the same reason as deleting: it hides the case that matters.

**Stay silent only for the untouched default set; warn for everything else.** Chosen. The warning
becomes:

```python
if config.builtin_names and set(config.builtin_names) != set(PI_DEFAULT_ACTIVE_BUILTINS):
    log.warning(
        "ClaudeHarness ignores built-in tool(s) %s; built-ins are a Pi concept",
        ", ".join(config.builtin_names),
    )
```

A default-derived template carries exactly the four Pi defaults and logs nothing. Anything else
warns, and the message names the tools, which the current message omits.

The first draft filtered name by name instead (`[n for n in builtin_names if n not in defaults]`)
and was wrong. A subset is a deliberate authoring act too: an author who selected only `bash` and
then switched to Claude would lose it silently, because every name in their set is in Pi's default
set. The code has no provenance field telling it which sets are default-derived, so the only honest
predicate is exact-set equality: the one set we can be sure the author never touched.

This is a heuristic, not a fact, and it is worth saying so. An author who deliberately selects
exactly Pi's four also gets silence. That is acceptable because the outcome is the same either way
(Claude drops them) and because the alternative is warning on the normal path. The real fix is for
agent creation to stop putting Pi built-ins in a Claude agent's template at all; see the note on
the harness preference below.

This needs a shared constant for Pi's four default built-in names on the Python side. There is no
such constant today; the four names live only in TypeScript at `run-plan.ts:192`. Have
`build_agent_v0_default()` build its `tools` entries from that constant so the default and the
warning cannot drift apart. Where the constant lives is settled two paragraphs below.

The Python constant and the TypeScript `PI_DEFAULT_ACTIVE_BUILTINS` are now two copies of the same
list in two languages. They are already two copies today, just implicitly. They should be two
implementations of one pinned contract rather than one "mirroring" the other, so
[testing.md](testing.md) pins both against a shared fixture.

Name the Python constant `PI_DEFAULT_ACTIVE_BUILTINS`, matching the TypeScript name exactly, and
make it a tuple. "Default built-in names" would be ambiguous with the seven-name vocabulary the
picker offers. Put it in a small neutral module for Pi harness facts rather than in
`agenta_builtins.py`: that module's own contract says it holds "the Agenta harness's forced
defaults: the things `AgentaHarness` always applies" (`agenta_builtins.py:1`), and Pi's native
active set is not an Agenta opinion. `AGENTA_FORCED_TOOLS` living there is correct precisely
because it *is* an Agenta opinion. Putting the two side by side would blur the distinction this
whole bug is made of.

## A Claude agent created from the default carries four dead entries

The create-agent factory copies the template and then overlays the author's last-used harness
(`web/packages/agenta-entities/src/workflow/state/appUtils.ts:186`, applied by
`applyAgentCreationPrefs` at `agentCreationPrefs.ts:32`). The preference sets `harness.kind` and
nothing else. So an author whose last agent was Claude creates a Claude agent that carries the four
Pi built-in entries in its tools list, where they do nothing: `ClaudeHarness` drops them, and the
Tools section shows four rows for tools the agent does not have.

This is cosmetic, not a correctness bug, and it is not worth blocking the fix. It is also the case
that would be solved properly by making the default set harness-dependent at creation time rather
than by a warning filter. Recorded in [open-questions.md](open-questions.md) with the surface
question, because both are about the same thing: the tools list is authored per harness and stored
per agent.

## No pinned wire contract moves

The `/run` request field stays `tools?: string[]`
(`services/runner/src/protocol.ts:469`). No field is added, removed, renamed, or retyped.

The shared golden fixtures under `sdks/python/oss/tests/pytest/unit/agents/golden/` do not change.
`test_wire_contract.py` builds its Pi payload from a hand-written
`PiAgentTemplate(builtin_tools=["read", "write"])` at `:125` and never touches
`build_agent_v0_default` or `AgentTemplate.from_params`, so the golden is unaffected.
`services/runner/tests/unit/wire-contract.test.ts` reads the same files and asserts on the parsed
request, not on a run plan built from it.

What changes is a value, not a contract: the default a new agent starts from.

## What the author sees and can change

There is already a built-in picker. It is a multi-select over Pi's seven names in
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PiSettingsControl.tsx:33`, it reads
and writes the same `parameters.agent.tools` array the Tools section shows
(`useModelHarness.tsx:1000`), and it renders inside Advanced under Permissions when the harness is
`pi_core` or `pi_agenta`.

So a picker is not the scope question. Three defects in what exists are, and two of them become
visible only because of this change.

**The help text is false, and this change makes it worse.** It reads "Optional Pi built-ins to
author explicitly; empty leaves Pi's harness defaults." Empty does not leave Pi's harness defaults.
Empty grants nothing. Even removing the field entirely grants nothing, because
`_parse_agent_fields` falls back to a default of `[]` (`dtos.py:1323`) and `wire_tools` always
emits the key. After this change the picker starts pre-populated with four selections, so an
author who clears it will read the help text, expect Pi's defaults, and get an agent with no
tools. Fix the text to say what happens: clearing the selection removes every Pi built-in from the
agent.

**Every built-in row is labelled "builtin".** `describeTool`'s built-in branch
(`agentTemplate/itemDescriptors.tsx:195`) labels the row from the entry's `type` and ignores its
`name`. Today that is a curiosity because templates rarely carry built-ins. After this change,
every new agent's Tools section shows four identical rows reading "builtin". Read the top-level
`name` when it is present.

**A built-in row opens a raw JSON editor.** `itemKinds.tsx:85` returns `"json"` for anything that
is not a function tool, a reference tool, or a gateway tool, so clicking a built-in row shows raw
JSON with no form. This is pre-existing and this change makes four of these rows appear in every
new agent.

The recommendation splits these.

In scope for this change: the help-text correction and the row label. Both are small, both are
directly caused by shipping built-ins in the default, and shipping the default without them
produces a visibly broken Tools list.

Out of scope, as a follow-up: adding built-ins to the Tools section's own
`AgentToolSelectorPopover` and giving a built-in row a real form instead of raw JSON. The reason
is that the useful version of this work is not "add a picker". A picker already exists in a second
place, so adding a third editing surface for the same array without deciding which one is
canonical makes the configuration harder to reason about, not easier. That decision is worth doing
properly and it is not on the critical path for a bug where agents have no tools. It is filed in
[open-questions.md](open-questions.md).

## Alternatives considered

### Change the runner so an empty list means Pi's defaults

Make `normalizePiBuiltinGrants` treat `[]` and `undefined` the same.

Rejected. It removes the author's ability to say "no built-ins" and it contradicts a decision made
deliberately in the [pi-builtin-gating design](../pi-builtin-gating/design.md), which states that
`tools: undefined` must differ from `tools: []`. It would also fix agents saved today, which is why
it keeps coming up. That benefit is real, and it is not worth an agent configuration where
deselecting every tool silently re-grants four of them.

### Make the SDK omit the field when the list is empty

Change `PiAgentTemplate.wire_tools()` to drop `tools` when `builtin_names` is empty, so the
runner's missing-field branch fires.

Rejected for the same reason, one layer up. It has the same effect as the option above and it is
harder to see, because the behavior would then depend on which of two identical-looking empty
values the SDK produced.

An earlier draft added a second reason, that this would break the Claude golden fixture which pins
`"tools": []`. That reason is wrong and has been removed. `ClaudeAgentTemplate.wire_tools()`
hardcodes `"tools": []` itself (`dtos.py:921`) and never reads `builtin_names`, so editing
`PiAgentTemplate.wire_tools()` cannot move `run_request.claude.json`. The rejection rests on the
authoring-semantics argument alone, which is sufficient.

### Repair agents already saved

Backfill the four built-ins into every existing agent revision whose `tools` list is empty, either
by a migration or by a read-time upgrade in `AgentTemplate.from_params`.

Out of scope by decision. Every agent saved since the empty default shipped carries `tools: []`
and stays broken until its author edits it.

The trade-off is real and worth stating. Not repairing means the reported bug persists for every
agent that already exists, and the people who hit it are the people who already built something.
Repairing means the platform reinterprets a saved configuration value: an author who genuinely
deselected every built-in would find four of them back. There is no stored signal that
distinguishes "the default put an empty list here" from "I chose none", because they are the same
value. A migration would therefore have to guess, and it would guess wrong for exactly the author
who cared enough to configure it.

The narrower version, backfilling only revisions whose `tools` list is empty and whose harness is
Pi and which were created before the fix ships, is implementable. It is deferred rather than
rejected. If the number of affected agents turns out to be large, revisit it as its own change
with its own review.

The workaround in the meantime is one edit: open the agent, expand Advanced, and select the
built-ins in the "Built-in tools" control. Committing a new revision fixes that agent.

### Change the default harness to `pi_agenta`

`AgentaHarness` already forces `read` and `bash` into every run
(`harnesses.py:141`). Making `pi_agenta` the default harness would give new agents those two
tools without touching the template.

Rejected. It grants two tools rather than four, so it does not fix editing or writing files. It
changes far more than tool availability: `pi_agenta` also forces an AGENTS.md preamble, a persona
appended to the system prompt, and a platform skill. Changing a harness default to fix a tools
default is a large, indirect change with side effects an author did not ask for.
