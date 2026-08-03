# Default agent built-in tools

A new Pi agent works in the playground and has no tools anywhere else. The shipped default agent
template lists no tools, and an empty tool list means "grant nothing" by the time it reaches Pi.
This workspace plans the fix: ship Pi's four default built-ins in the default agent template.

Reported as [#5590](https://github.com/Agenta-AI/agenta/issues/5590) (from the agent's side) and
[#5562](https://github.com/Agenta-AI/agenta/issues/5562) (from the automation's side).

## Reading order

| File | The question it answers |
| --- | --- |
| [context.md](context.md) | What does a user see, why does it happen, and what is in and out of scope |
| [research.md](research.md) | What the code does today, with file and line references |
| [design.md](design.md) | What we change, what we considered instead, and why |
| [plan.md](plan.md) | The order of work, split into landable pieces |
| [testing.md](testing.md) | Which tests to write and where, including the one that would have caught this |
| [open-questions.md](open-questions.md) | What is not decided and who decides it |
| [status.md](status.md) | Current state of the work |

## Words used here

- **Harness**: the coding agent the platform drives inside the sandbox. Today `pi_core` (Pi),
  `pi_agenta` (Pi with a forced Agenta opinion layered on), and `claude` (Claude Code).
- **Runner**: the TypeScript service at `services/runner/` that receives a `/run` request, starts
  the harness in a sandbox, and streams events back.
- **Sandbox**: the isolated filesystem and process space a run executes in, either `local` (a
  temporary directory on the runner host) or `daytona` (a remote container).
- **Built-in**: one of the seven tools Pi implements inside itself: `read`, `bash`, `edit`,
  `write`, `grep`, `find`, `ls`. The model calls a built-in the same way it calls any other tool,
  but the code runs inside Pi rather than inside Agenta.
- **Grant list**: the `tools` field of a `/run` request. It names which Pi built-ins this run may
  use. The runner deletes every built-in that is not named.
- **Agent template**: the saved agent configuration at `parameters.agent` of a workflow revision.
  It holds instructions, model, tools, MCP servers, skills, and the execution selectors
  (`harness`, `runner`, `sandbox`).
- **Build kit overlay**: an extra fragment of agent template the backend serves to the playground
  and the playground merges into a run. It adds authoring tools and an authoring skill. It is
  never saved into the agent.
- **Permission mode**: the agent-wide policy for whether a tool runs, pauses for approval, or is
  refused. The four modes are `allow`, `ask`, `deny`, and `allow_reads`. The shipped default is
  `allow_reads`: read-only tools run, everything else asks.

## The change in three sentences

`build_agent_v0_default()` gains four entries in its `tools` list, one for each of Pi's own
default built-ins (`read`, `bash`, `edit`, `write`), so a newly created agent carries them
wherever it runs instead of only inside the playground. Nothing about the runner's grant-list
semantics changes: an empty list still means "grant nothing", and permission gating still asks
before `bash`, `edit`, or `write` runs. The supporting work corrects what the author is told: the
built-in picker's help text currently claims an empty selection leaves Pi's defaults, which is the
opposite of what happens, and every built-in row in the Tools list is labelled "builtin" rather
than its own name.

## Related work

- [pi-builtin-gating](../pi-builtin-gating/README.md) built the grant-list enforcement and the
  permission gate this project depends on. Its `context.md` names the empty-list trap; its
  `design.md` explains why `tools: undefined` and `tools: []` must stay different.
- [approval-boundary](../approval-boundary/README.md) owns the one decision module every gate
  calls.
- [build-kit-overlay-delivery](../../../build-kit-overlay-delivery/) owns how the playground
  overlay reaches the frontend.
