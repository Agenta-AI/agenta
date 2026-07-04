# Context: why gate Pi's builtins

## What a builtin is

Pi runs an agent loop with seven tools built into the harness: `read`, `bash`, `edit`,
`write`, `grep`, `find`, and `ls`. The model calls them the same way it calls a custom tool.
The difference is where they execute. A custom tool runs through our code. A builtin runs
inside Pi itself, and Pi never asks us for permission first.

## Gap 1: the author cannot gate a builtin

Our permission model is small and clear. An author sets one global default and optional
per-tool rules. Each tool resolves to `allow`, `ask`, or `deny`. The four global modes are
`allow`, `ask`, `deny`, and `allow_reads` (reads run, everything else asks). This model is
described in the approval-boundary workspace at
[projects/approval-boundary/how-approvals-work.md](../approval-boundary/how-approvals-work.md).

The model works for every tool that reaches a gate. Claude's tools reach a gate because
Claude asks over its own protocol. Our custom tools reach a gate because we execute them
and check first. Pi's builtins reach no gate at all. So `bash: ask` does nothing on Pi. The
shell command runs. This is the sharpest gap, because `bash` is the one builtin most authors
would want to pause on.

## Gap 2: the grant list stopped working

The run request has a field for the enabled builtins: `tools?: string[]` at
`services/runner/src/protocol.ts:423`, commented "Built-in tools to enable". The SDK fills
it from the author's selection (`PiAgentTemplate.wire_tools` in
`sdks/python/agenta/sdk/agents/dtos.py:829` emits `"tools": list(self.builtin_names)`), and
the playground's Pi settings control writes that selection.

The runner ignores the field. It went dead in commit `0e71bd0f7a` (2026-06-24, "remove
legacy in-process backend"). That commit deleted the old in-process engine, and that engine
held the only code that read the list. So the selection an author makes in the UI has no
effect. Every builtin is always available. The commit message is honest that it removed the
in-process path as dead code; the grant list was collateral, and no one has re-wired it since.

## Why the two gaps share one fix

Both gaps are the same missing thing: a point where the runner sees a builtin call before it
runs and gets to decide. Add that one interception point and both gaps close. A non-granted
builtin gets refused. A granted builtin gets the author's `allow | ask | deny`.

## Tie to the approval-boundary redesign

The approval-boundary workspace ([projects/approval-boundary/](../approval-boundary/))
established a doctrine we follow here: **one decision module.** The rule about whether a tool
runs, pauses, or is denied lives in exactly one place, `decide()` in
`services/runner/src/permission-plan.ts`, and every gate calls it. That workspace's plan
([projects/approval-boundary/plan.md](../approval-boundary/plan.md)) lists the gates: the SDK
settings renderer for Claude, the ACP responder for Claude's live gates, and the relay for
tools the runner executes itself.

Builtin gating adds a fourth caller of the same `decide()`. It does not add a second policy
engine. The whole point of the design below is that the runner decides builtins with the same
function, the same `GateDescriptor`, and the same stored-decision resume machinery that
custom-tool asks already use. The extension only reports the call and enforces the answer.
This keeps the doctrine intact: the sandbox never decides policy; it asks the runner.

## Non-goals

- No new policy language. Authors express builtin rules with the existing `allow | ask |
  deny` and the four global modes.
- No per-builtin permission field on the config yet. The SDK currently drops a per-builtin
  permission loudly (`BuiltinToolConfig._drop_unenforceable_permission` in
  `sdks/python/agenta/sdk/agents/tools/models.py:87`) because nothing enforced it. This
  design makes enforcement possible, so re-enabling that field becomes a small follow-up, but
  it is out of scope here. Authors still gate builtins through global-mode rules and pattern
  rules (for example `bash(git:*)`).
- No change to Claude. Claude already gates its own tools.
