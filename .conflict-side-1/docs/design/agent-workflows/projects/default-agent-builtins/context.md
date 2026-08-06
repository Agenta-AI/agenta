# Why this work exists

## What a user sees today

An author creates an agent in the playground and leaves the configuration at its defaults. The
harness is `pi_core`. In the playground the agent runs shell commands, reads files, and writes
files. The author saves the agent, then runs the saved revision from a schedule, from the API,
or from any other caller that is not the playground. The agent answers:

```text
I couldn't run this because no shell or filesystem tool is available in the current session.
No workspace, .env, script, or outputs were accessed.
```

Nothing was read. Nothing was written. The run reached the model, the model reported that it had
no tools, and the turn ended.

Two reports describe this failure from two sides. [#5590](https://github.com/Agenta-AI/agenta/issues/5590)
reports it from the agent's side ("Pi agents run with no read, bash, edit or write tools outside
the playground"). [#5562](https://github.com/Agenta-AI/agenta/issues/5562) reports it from the
automation's side ("Automations need to have sessions. Otherwise they cannot write files").

Claude agents do not show this failure. Claude brings its own Read, Bash, and Write tools over
its own protocol. The failure is specific to Pi.

## Words used throughout this workspace

- **Harness**: the coding agent the platform drives inside the sandbox. Today `pi_core` (Pi),
  `pi_agenta` (Pi with a forced Agenta opinion), and `claude` (Claude Code).
- **Runner**: the TypeScript service at `services/runner/` that receives a `/run` request,
  starts the harness in a sandbox, and streams events back.
- **Sandbox**: the isolated filesystem and process space a run executes in. Either `local` (a
  temporary directory on the runner host) or `daytona` (a remote container).
- **Built-in**: one of the seven tools Pi implements inside itself: `read`, `bash`, `edit`,
  `write`, `grep`, `find`, `ls`. The model calls a built-in the same way it calls any tool, but
  the code runs inside Pi rather than inside Agenta.
- **Grant list**: the `tools` field of a `/run` request. It names which Pi built-ins the run may
  use. The runner deletes every built-in that is not named.
- **Agent template**: the saved agent configuration at `parameters.agent` of a workflow revision.
  It holds instructions, model, tools, MCP servers, skills, and the execution selectors
  (`harness`, `runner`, `sandbox`).
- **Build kit overlay**: an extra fragment of agent template the backend serves to the playground
  only. It adds authoring tools and an authoring skill. It is never saved into the agent.

## Why it happens

The agent template's `tools` list is empty in the shipped default, and an empty grant list means
"grant nothing" all the way down to Pi.

The chain has four links.

1. `build_agent_v0_default()` in `sdks/python/agenta/sdk/utils/types.py:1412` emits
   `"tools": []`. This is the value the playground pre-fills into a new agent and the value the
   built-in agent interface advertises, so every agent saved from the default starts with an
   empty tool list.

2. The SDK resolves that list into `builtin_names`. `ToolResolver.resolve` in
   `sdks/python/agenta/sdk/agents/tools/resolver.py:113` picks out the entries of type `builtin`.
   An empty list yields an empty `builtin_names`.

3. `PiAgentTemplate.wire_tools()` in `sdks/python/agenta/sdk/agents/dtos.py:881` always writes
   `"tools": list(self.builtin_names)` into the `/run` body. It writes the field even when the
   list is empty.

4. The runner reads that field. `normalizePiBuiltinGrants` in
   `services/runner/src/engines/sandbox_agent/run-plan.ts:196` distinguishes two cases:

   ```ts
   function normalizePiBuiltinGrants(tools: string[] | undefined): string[] {
     if (tools === undefined) return [...PI_DEFAULT_ACTIVE_BUILTINS];
     if (!Array.isArray(tools)) return [];
   ```

   A missing `tools` field means "use Pi's own defaults", which are `read`, `bash`, `edit`,
   `write`. An empty array means "grant nothing". Because step 3 always writes the field, the
   missing-field branch is unreachable from the platform. Every platform run takes the
   empty-array branch.

   `replaceActiveBuiltinTools` in `services/runner/src/extensions/agenta.ts:157` then rewrites
   Pi's active tool set, keeping only the granted built-ins. With no grants, Pi's active set
   contains no `read`, no `bash`, no `edit`, and no `write`. The model is not refused at call
   time. The tools are absent from its tool list, so it correctly reports that it has none.

The two branches of `normalizePiBuiltinGrants` are deliberate. The
[pi-builtin-gating design](../pi-builtin-gating/design.md) states that `tools: undefined` and
`tools: []` must stay different, because an author who deselects every built-in must get an agent
with no built-ins. The problem is not that rule. The problem is that the shipped default expresses
"the author has not chosen" using the syntax for "the author chose none".

## Why the playground is the exception

The build kit overlay repairs the default for playground runs only.
`build_agent_template_overlay()` in `api/oss/src/core/workflows/build_kit.py:75` prepends two
built-in entries to the template's `tools` list:

```python
"tools": [
    *[{"type": "builtin", "name": name} for name in AGENTA_FORCED_TOOLS],
    ...
]
```

`AGENTA_FORCED_TOOLS` is `["read", "bash"]`
(`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:64`). The overlay exists to make the
authoring experience work: the build kit ships platform tools and a skill, and a skill is
unreadable without `read` and unrunnable without `bash`. The overlay is served to the playground
and merged into the run parameters there. It is never committed into the agent, so the moment the
author saves and runs the agent anywhere else, the two built-ins disappear with it.

The overlay grants `read` and `bash` only, not `edit` and `write`. The issue reports an agent that
writes files in the playground. That works because Pi's `bash` can write files through shell
redirection, not because `write` was granted.

## Goals

- A newly created Pi agent has `read`, `bash`, `edit`, and `write` in its tool list wherever it
  runs, not only in the playground. Whether a given call runs is then the permission model's
  decision, which is what it should be. A scheduled agent under the shipped default permission mode
  still pauses at its first shell command;
  [design.md](design.md#what-this-fixes-and-what-the-reporter-will-still-hit) traces exactly how
  far the reported run gets after this change.
- The author can see which built-ins the agent has, and can remove any of them.
- The permission behavior that ships today is unchanged. The default permission mode is
  `allow_reads`, so `read` runs without asking and `bash`, `edit`, and `write` raise an approval.
  Granting a tool is not the same as letting it run unattended, and this work does not blur that.

## Non-goals

- **Repairing agents already saved.** Every agent saved since the empty default shipped carries
  `tools: []`. This work does not migrate them. The reasoning is in
  [design.md](design.md#alternatives-considered).
- **Changing the runner's empty-array semantics.** `tools: []` keeps meaning "grant nothing".
- **Making unattended runs bypass approvals.** A scheduled Pi agent that calls `bash` under the
  default permission mode still raises an approval. Whether an unattended run should be able to
  proceed is a separate question, tracked in [open-questions.md](open-questions.md).
- **A per-built-in permission field.** `BuiltinToolConfig` still drops an authored `permission`
  with a warning (`sdks/python/agenta/sdk/agents/tools/models.py:87`). Re-enabling it is a
  separate change.
