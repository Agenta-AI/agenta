# Open questions

## Does a scheduled agent need a way to run write-capable tools?

**Needs a product decision.**

A saved agent with the shipped default permission mode `allow_reads` stops at its first `bash`,
`edit`, or `write` call when nobody is watching. The turn ends with `stopReason: "paused"`, the
sandbox is destroyed, and the schedule's delivery row records a success. The evidence is in
[design.md](design.md#what-this-fixes-and-what-the-reporter-will-still-hit).

Granting Pi's built-ins in the default template is necessary and is not sufficient for the
scenario in [#5590](https://github.com/Agenta-AI/agenta/issues/5590). The author can already
unblock their own agent by setting the permission mode to `allow` or adding an allow rule for
`Bash`, so nothing is impossible today. The question is whether the platform should make that
easier, and how.

Three shapes exist, and they are not equivalent.

- **Leave it.** The author sets `allow` when they want an unattended agent. This is honest and
  costs nothing to build. It means the default configuration cannot complete an unattended task,
  and the failure is invisible: the delivery says success.
- **Make the failure visible.** Keep the behavior and surface it. A run that ends
  `stopReason: "paused"` with no client that can answer is a failed delivery, not a successful
  one, and the schedule should say so. This is the smallest change that stops the silent stop.
- **Give an unattended run its own policy.** Let a schedule or trigger carry a permission
  decision, so an author can say "this automation may run shell commands" without weakening the
  agent's interactive default. Nothing today can carry such a value: the trigger dispatcher builds a
  request with only references, selector, and inputs
  (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:309`), and the permission plan comes only from
  the saved variant.

This question is out of scope for this workspace and is the substance of
[#5562](https://github.com/Agenta-AI/agenta/issues/5562). It needs its own design.

## Should the runner enforce a grant list even when the approval gate is off?

**Not this project's to decide, but this change is what makes it matter.**

`computeBuiltinGatingActive` (`run-plan.ts:233`) returns false when the permission plan cannot gate
a built-in and the grant list equals Pi's own defaults. The runner then never sets
`AGENTA_AGENT_BUILTIN_GATING`, so the extension skips `registerBuiltinGating` entirely and
`replaceActiveBuiltinTools` never runs. One flag turns off both the approval relay and the
active-set enforcement, and only one of those is a performance concern.

Today the outcome is still correct, because the set the runner would enforce and the set Pi
activates on its own are the same four names. The exposure is a future Pi release that adds a fifth
tool to its default active set: an agent under a blanket `allow` policy would get it despite a
saved grant list naming four. This change is what moves the shipped default onto that path, since
today's `tools: []` never equals Pi's defaults and gating is therefore always on.

The fix is to split the two concerns: always apply the grant list, and let only the approval relay
take the fast path. That is a change to `computeBuiltinGatingActive` and the extension's inertness
guard, both owned by [pi-builtin-gating](../pi-builtin-gating/README.md). It is filed there rather
than done here. The cross-language constant pin in [testing.md](testing.md) is the interim guard:
it fails the moment the two lists diverge.

## Should `read` be approval-free on the local sandbox?

**Needs a decision before this ships to a shared deployment.**

`read` is classified read-only (`permission-plan.ts:40`) and `allow_reads` runs it without asking.
On the shipped default sandbox `local`, that is an approval-free read of any file the runner
process can open: the run executes on the runner host (`provider.ts:148`), Pi's `read` accepts
absolute paths and applies no cwd jail, and `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` defaults to
`["local"]` when unset. The full trace is in
[design.md](design.md#what-read-can-reach-on-the-local-sandbox).

The capability exists today through the playground overlay. What this change adds is the
unattended, non-playground version of it. Three responses are available and they are not
equivalent: stop enabling `local` by default, confine built-in filesystem operations to the run
cwd in the runner, or reclassify `read` so it also asks. The first is deployment policy, the second
is runner work, the third would make the default agent ask before every file read and is probably
too blunt.

This is not a reason to drop `read` from the default template. It is a reason not to ship the
default template into a shared deployment that still enables `local`.

## Should agents saved before the fix be repaired?

**Decided: no, for now.** Recorded here because the trade-off should stay visible rather than be
forgotten.

Every agent saved since the empty default shipped carries `tools: []` and keeps failing outside the
playground until its author edits it. Repairing them means reinterpreting a stored value, and there
is no signal that separates "the default put an empty list here" from "I deselected everything",
because they are the same value. The full reasoning is in
[design.md](design.md#repair-agents-already-saved).

Revisit if the count of affected agents turns out to be large. The narrow version, backfilling only
Pi agents whose tools list is empty and whose revision predates the fix, is implementable as its
own change.

## Which surface owns editing built-in tools?

**Needs a decision before the follow-up work, not before this fix.**

Built-ins are editable today from a multi-select in Advanced under Permissions
(`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PiSettingsControl.tsx`). They also
appear as rows in the Tools section, where clicking one opens a raw JSON editor. Two surfaces edit
the same array with different affordances, and neither is obviously the canonical one.

The options are to make the Tools section canonical and drop the Advanced multi-select, to keep the
multi-select and make Tools rows read-only, or to keep both and give the Tools row a real form. The
third preserves the current split and is the least decisive.

This change corrects the two defects that shipping built-ins in the default makes visible (the
false help text and the row label). It does not add a third editing surface, because adding one
before deciding which surface is canonical makes the configuration harder to reason about. See
[design.md](design.md#what-the-author-sees-and-can-change).

Two related questions belong with this one, because all three are about the same thing: the tools
list is authored per harness and stored per agent.

**Should the default set depend on the harness?** A new agent created while the last-used harness
preference is `claude` carries four Pi built-in entries that Claude drops
(`appUtils.ts:186`, `agentCreationPrefs.ts:32`). Making creation harness-aware would fix that
properly, and would also remove the need for the exact-set heuristic in the Claude warning
(see [design.md](design.md#the-claude-harness-warning)).

**Should "unset" and "explicitly empty" be different values?** They are the same value everywhere
today: `AgentTemplateSchema.tools` and `AgentTemplate.tools` both use `default_factory=list`
(`types.py:1228`, `dtos.py:604`), and the picker writes `undefined` when the author clears the
selection (`PiSettingsControl.tsx:83`). This is exactly the ambiguity that makes repairing existing
agents impossible. Making the shape tri-state, and persisting `[]` on a deliberate clear, would not
repair a single existing agent, but it stops the platform creating more of them. Worth doing on its
own; out of scope here.

## Do the four built-in names now collide with an author's own tool?

**Known consequence of this change. Not fixed here, and worth watching.**

`read`, `bash`, `edit` and `write` are now occupied names for every agent created from the default
template. Built-in names and resolved tool specs share one namespace: `_validate_unique_names`
(`sdks/python/agenta/sdk/agents/tools/resolver.py:84`) walks `[*builtin_names, *tool_specs]` and
raises `DuplicateToolNameError` on the first repeat, which fails the whole run. An author-defined
client tool, gateway tool, or workflow tool called `write` was legal before this change and now
aborts the run of any agent that still carries the shipped built-ins.

The blast radius is small (the names are short and generic, but an author who wanted one has to
have picked exactly it) and the failure is loud rather than silent, which is why the behavior is
left alone. The options, if it does bite: namespace built-ins on the wire so the two sets cannot
collide, let an author tool of the same name shadow the built-in rather than fail, or keep failing
and say so in the picker before the run.

## The agent service's own fallback default

**Fixed alongside the builder default, after review.**

`services/oss/src/agent/config.py` supplies the fallback for a request that carries no agent
template at all, and it does not call `build_agent_v0_default()`. It shipped `tools: []` in both
copies: the on-disk `services/runner/config/agent.json` and the in-code `DEFAULT_TOOLS` used when
that file is missing. Both now carry the same four `builtin` entries, sourced from
`PI_DEFAULT_ACTIVE_BUILTINS` so they cannot drift, and the stale sync comment at the top of
`config.py` was corrected.

It still hand-copies the default model and AGENTS.md text. Folding those into the builder is a
small cleanup worth doing on its own.
