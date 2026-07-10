# Context: warm and resumable Daytona sessions (F-020)

## The symptom

Every conversational turn on a Daytona agent pays full sandbox creation. QA measured this at
about 20 seconds or more per turn on a live E3 run. A user sends a second message in the same
chat and waits through a cold provision, a mount, and a harness startup that the previous turn
already paid for. This is the whole problem: Daytona has no warm reuse between turns.

## Why it happens

Three independent mechanisms combine to force a cold create on every turn.

1. The runner tore the sandbox down at turn end. Before the lifecycle work described below,
   `provider.ts` created the Daytona sandbox with `ephemeral: true`, and an ephemeral sandbox
   auto-deletes when it stops. So the sandbox was gone by the time the next turn arrived.

2. PR #5197 added a `sandbox-reconnect` module that stores the sandbox id and restarts a
   stopped or archived sandbox on the next turn instead of provisioning fresh. But because the
   sandbox was deleted at turn end, the stored id never resolved. Reconnect was a dead rung:
   the runner logged "reconnect failed ... not found, creating fresh" on every follow-up turn.

3. The in-memory keep-alive pool that gives local sessions warm reuse is gated local-only on
   purpose (`resolvesToLocalProvider` in `session-pool.ts`, `isLocalSandbox` in `server.ts`).
   The gate is deliberate. Local keep-alive spends host RAM only; a warm Daytona sandbox spends
   billed compute, and a leaked one costs money. The `session-keepalive` workspace deferred the
   remote extension to "slice 3" for exactly this reason.

The 15-minute `SANDBOX_AGENT_DAYTONA_AUTOSTOP_MINUTES` that existed at the time was a leak
backstop, not a reuse mechanism. It stopped an abandoned sandbox so it stopped billing; it did
nothing to make the next turn fast.

This is finding F-020 in `docs/design/agent-workflows/projects/qa/findings.md`. It is triaged
`minor` and `defer`: correctness is fine (durable continuity restores the transcript and the
resumed turn answers correctly in about 20 seconds), but every turn pays create latency.

## What changed under our feet: the untested lifecycle commit

F-020 and the brief that started this project describe the PR #5197 state. The working tree has
since moved past it. Commit `60990d396e` ("[fix] Resolve hot/warm/cold/dead/new lifecycle
(untested)") already implements most of Tier 1 below, and it is unverified. Any plan here has to
start from the real current state, not from F-020's premise. See `research.md` for the exact
code. In short, at HEAD:

- `provider.ts` now creates with `ephemeral: false` and a five-state lifecycle: `autoStop = 5`
  min, `autoArchive = 15` min, `autoDelete = 30` min. Daytona's own reapers park then reap.
- `sandbox_agent.ts` teardown takes a `keepWarm` option. On a resumable Daytona turn it calls
  `pauseSandbox()` (stop, keep the disk) instead of `destroySandbox()` (delete).
- Both run paths (`runSandboxAgent` and the keep-alive `runCold`) pass `keepWarm` when the turn
  succeeded, was not aborted, the client did not disconnect, and the turn did not pause.
- Reconnect is wired: `readStoredSandboxId` at acquire restarts the stored sandbox; a failure
  falls through to a fresh create; `writeSandboxId` records the live id forward.
- A `pnpm patch` on `sandbox-agent@0.4.2` adds native ACP `loadSession` so a reconnected
  sandbox resumes the harness session in place, with transcript replay as the fallback.

So Tier 1 is prototyped end to end but untested and unproven live. This project is a takeover:
verify it, close its gaps, decide the orphan-cleanup story, and decide whether and when to add
the true warm pool (Tier 2).

## Goals

- Make a second Daytona turn in the same conversation avoid a full cold create.
- Keep the parked cost honest and bounded. Storage-only for the default tier; a clear billing
  knob for any tier that parks live compute.
- Never leak a running sandbox. The orphan-cleanup story has to be at least as safe as the
  `ephemeral: true` behavior it replaces.
- Keep durable continuity (PR #5197) as the always-correct fallback rung.

## Non-goals

- Fixing the Daytona tool-call hang (F-018). Warmth helps chat first; tool turns fail on
  Daytona until F-018 lands, and a failed turn does not park.
- Multi-replica pool routing. The runner is single-replica; a pool miss degrades to cold.
- Changing the wire contract, the SDK, or the frontend. This is a runner-only change.
- Running live Daytona sandboxes during this design pass (credits). Verification is by code
  read and unit or contract tests; live QA is called out as a follow-up, not done here.

## Who cares

Anyone running a multi-turn chat agent on Daytona through the deployed app. Today they wait 20
seconds per turn. The build-kit default agent is hit hardest because its "read the skill first"
instruction makes the model open with a tool call, though that path is currently blocked by
F-018 rather than by cold-create latency.
