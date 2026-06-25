# Context

## Why this work exists

Human-in-the-loop tool approval is the interactive contract of the agent playground. A run
that wants to call a sensitive tool should pause and ask the human, not silently run it and
not silently refuse it. The whole stack was built for this:

- The frontend renderer (`ToolPart.tsx`) has an `approval-requested` state with **Approve /
  Deny** buttons and an "Awaiting approval" chip.
- The chat panel wires the AI SDK v6 approval round-trip (`addToolApprovalResponse`,
  `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`).
- The SDK egress maps the runner's protocol-neutral `interaction_request` event to the AI SDK
  `tool-approval-request` stream part, and maps the inbound `tool-approval-response` back into
  an `{ approved: boolean }` tool-result block.
- The runner has a cross-turn responder (`HITLResponder`) that parks an undecided permission
  on turn N and resolves it from the stored reply on turn N+1.

Each piece exists and is unit-tested. But end to end, in the live playground, the round-trip
does not work.

## The symptom (F-024)

Repro: Claude harness + `haiku` + the GitHub gateway tool delivered over MCP. In "Advanced:
Claude permissions" set an **Ask** rule matching the tool (`mcp__*`, the tool name, or
`mcp__composio__*`). Prompt: "Use the GET_THE_AUTHENTICATED_USER github tool now ... then
reply with HITL-DONE."

What happens:

- The Claude permission gate **does** fire (proof the `ask` rule is honored end to end —
  the Claude `.claude/settings.json` is rendered correctly and the harness raises the gate).
- The playground shows **no** "Run this tool?" Approve/Deny prompt and **no** "Awaiting
  approval" chip.
- The tool-call card resolves straight to **ERROR: "User refused permission to run tool."**
  The run auto-denies without ever pausing for the human.

Second defect: the Pi **Permission policy** field offers only `auto` / `deny` — no `ask` — so
HITL is not configurable for Pi at all from the form.

## Why it matters

Without this, the playground cannot demonstrate the agent feature's most important safety
property. "Ask before running" is the difference between a demoable governed agent and an
ungoverned one. The renderer and the cross-turn resume are already paid for; the run just
never reaches them.

## Scope

In scope:

- The runner permission-gate handling for the Claude harness (the `interaction_request` ↔
  responder reply ↔ resulting tool-result on the wire).
- The protocol/stream egress mapping of the parked gate (verify it survives to the FE).
- The frontend approval surface (verify it renders and resumes once the wire is correct).
- The Pi permission model: expose `ask` honestly, or document precisely what Pi needs.
- A test plan that covers FE + SDK + runner, including the cross-turn resume.

Out of scope (tracked elsewhere):

- Relay-tool HITL for resolved `code`/gateway tools (open-issues "Relay-tool HITL: resolved
  code/gateway tools cannot park/emit/resume (S5.2)"). Note: in the F-024 repro the gateway
  tool is delivered to Claude **over MCP**, so the gate that fires is the **harness** gate,
  not the relay — this fix targets the harness path, which is the one F-024 exercises.
- A real Pi interactive permission protocol (Pi has no ACP permission capability today).

## Goals

1. When an `ask` rule fires on the Claude harness, the playground shows the inline
   Approve/Deny prompt and pauses (no auto-deny, no ERROR card).
2. Approve resumes the run and the tool actually executes; Deny leaves it un-run and the model
   continues without it.
3. Pi `ask` is either honestly exposed (with runner enforcement) or honestly hidden, with the
   decision and the follow-up tracked.
4. The fix is the smallest change that makes the existing FE + egress + resume machinery work,
   with regression tests at each layer.

## Non-goals

- Re-architecting the responder or the cross-turn model (it is already built and unit-tested;
  the bug is one conflicting reply on the wire).
- Building relay-tool park/resume (S5.2) in this fix.
- A new wire field if the existing `interaction_request` / `tool-approval-request` carriers
  suffice (they do).
