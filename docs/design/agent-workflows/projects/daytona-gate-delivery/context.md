# Context

## What breaks

A tool-using agent on a Daytona sandbox hangs on its first tool call. Chat-only turns
work. Any turn that calls a Pi builtin (bash, read, edit, write, grep, find, ls) stalls
until the 300s run-limits guard kills it. The user sees no approval prompt and no result,
just a long wait and then a failed turn.

The QA matrix caught this as F-018 during the E3 (Daytona) runs. It reproduces in the
playground UI, not only the driver. Sessions `fd02cd78` and `7ec8186b` both hung on
Daytona with no approval prompt shown.

## Why it matters

Chat on Daytona works after the F-017 remote-mount fix (PR #5197). Tool use does not. That
leaves Daytona usable for pure conversation and broken for the agents people actually
build.

It also breaks the build-kit default agent on Daytona. That agent's instructions tell the
model to read its skill file first. The model opens the turn with a `read`, which is a
builtin, so the first turn dies whenever the model follows its own instructions.

## The mechanism in one paragraph

Builtin gating is on. For every builtin call, the Pi extension inside the sandbox raises
`ctx.ui.confirm`, even when the policy would allow the call. The allow, ask, or deny
decision is made on the runner, after the gate surfaces there. The `pi-acp` bridge turns
that confirm into an ACP `session/request_permission` reverse request. On a Daytona
sandbox that reverse request never reaches the runner, so the confirm never resolves. The
confirm is deliberately built with no reaper, so the tool waits forever. The 300s guard is
the only thing that ends it. The full path, with file and line references, is in
[research.md](research.md).

## Goals

- A builtin call on Daytona that the policy allows runs without stalling.
- A builtin call on Daytona that the policy denies is blocked with a clear result.
- A builtin call on Daytona that needs a human decision (ask) surfaces a real approval
  prompt in the UI and resumes correctly when the human answers.
- Any gate that cannot be answered fails closed with a clear error, and never stalls to
  the 300s guard.
- Local behavior is unchanged. Daytona and local stay interchangeable for the `pi`
  harness, which is the whole promise of the sandbox axis.

## Non-goals

- Fixing the Daytona proxy itself, or rewriting the vendored `sandbox-agent` transport.
  Option A in [options.md](options.md) would need that, and the plan rejects it as the
  primary path.
- Changing the approval model, the permission plan schema, or the `pi-gate-envelope`
  contract for the local path.
- Sandboxing where code tools execute (F-010) or session-resume sandbox reuse (F-020).
  Those are separate findings.

## Constraints the fix must respect

- The sandbox is not trusted to state its own permissions. The current
  `pi-gate-envelope` design carries tool identity only, never policy, for exactly this
  reason. Any option that moves a decision into the sandbox must argue why it is safe for
  the specific tool class it covers.
- Builtin execution already happens inside the sandbox with no runner mediation. The gate
  is the only control point for a builtin. This shapes which trust arguments hold.
- Custom (callback and gateway) tool execution relays back to the runner, which re-checks
  the decision at the relay guard. That second enforcement point exists for custom tools
  and does not exist for builtins.
