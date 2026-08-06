# Runner code-tools dead code removal

This workspace plans the removal of the disabled code-tool execution path from the runner.

## Glossary

- **Runner**: the `services/runner` process (the `sandbox-agent` sidecar) that executes agent
  runs and dispatches tool calls.
- **Code tool**: a tool whose author supplies a snippet the runner used to execute in-process
  (`kind: "code"` on the wire, `type: "code"` in the SDK).
- **Dispatch site**: a place in the runner that branches on `spec.kind` to run a resolved tool
  (`tools/dispatch.ts`, `tools/relay.ts`).
- **The guard**: the up-front refusal in `engines/sandbox_agent/run-plan.ts`. It rejects any run
  that carries a code tool before execution starts.

## Current state

Code tools are already disabled. Execution was removed for security (finding F-010). Today the
runner still carries the disabled executor and the branches that route into it. That code is
dead. This workspace plans its removal without changing the observable behavior: a run declaring
a code tool must still fail loudly with the same message.

## Reading order

- `plan.md` answers: what is dead, what stays, how much of `code.ts` survives, and the removal
  sequence with its verification gates.
- `status.md` answers: what is decided, what is open, and the current step.

## Threat model of record

Finding F-010 (`../qa/findings.md`, "F-010 Code tools execute in the trusted runner with no
sandboxing") remains the threat model for any future re-enablement. This removal deletes dead
code only. It does not re-open code execution and does not weaken the guard. Any work that
re-enables code tools must re-read F-010 first.
