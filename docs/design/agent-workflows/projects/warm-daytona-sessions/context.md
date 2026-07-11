# Context: warm and resumable Daytona sessions

## What a user sees today

When you chat with an agent that runs on Daytona, every message waits about twenty seconds
before the agent starts to answer. QA measured this on a live run (the E3 scenario, a scripted
chat used to test the agent runtime). The wait is the same on every turn. Your second message
in a conversation waits just as long as your first, because the runner builds a brand-new
sandbox for it, mounts its files, and starts the harness from scratch. Nothing from the
previous turn is reused.

A few terms, since they recur below:

- **Sandbox**: the isolated cloud machine an agent runs in. On Daytona it is a billed resource.
- **Runner**: the Agenta service that drives one agent turn. It creates the sandbox, runs the
  turn inside it, and tears it down.
- **Harness**: the agent program inside the sandbox (Claude Code or Pi).
- **Park a sandbox**: stop it but keep its disk, so the next turn can restart the same one
  instead of rebuilding it.

The slow turn is the whole problem. This is QA finding F-020.

One measured fact sharpens where the twenty seconds goes (research.md, 2026-07-11): creating the
Daytona sandbox itself takes under 2 seconds. The rest of the wait is our own per-turn setup
inside and around it: starting the daemon, uploading assets, mounting files, starting the
harness, and reloading the conversation. That setup only disappears entirely when the sandbox,
with its processes, stays running between turns. This is why the plan builds up to keeping
sandboxes running for a short window, not just to stopping and restarting them.

The answer itself is still correct. A separate feature, durable session continuity (PR #5197),
saves the conversation to storage and replays it into the fresh sandbox, so the agent remembers
what was said. The only cost is speed. Correctness is fine; every turn just pays the full build
time.

## What recent work already tried

The working tree has moved past the state F-020 described. A recent, still-untested commit
(`60990d396e`, "Resolve hot/warm/cold/dead/new lifecycle") already wired up most of the
warm-reuse machinery. Any plan has to start from this real current state, not from F-020's
older premise. Here is what that commit put in place:

- **Keep the sandbox instead of deleting it.** `provider.ts` now creates the sandbox with
  `ephemeral: false`, which means a stopped sandbox is parked, not auto-deleted. It also sets
  three idle timers: stop after 5 minutes, move to cheaper cold storage after 15, delete after
  30. Daytona runs these timers itself.
- **Park at a clean turn end.** The teardown path (`sandbox_agent.ts`) takes a `keepWarm`
  option. On a Daytona turn that finished cleanly, it calls `pauseSandbox()` (stop, keep the
  disk) instead of `destroySandbox()` (delete). Both run paths request `keepWarm` only when the
  turn succeeded, was not aborted, and the user did not disconnect.
- **Reconnect on the next turn.** The runner stores the sandbox id, and on the next turn it
  reads that id back and restarts the same sandbox instead of provisioning a fresh one.
- **Reload the conversation in place.** A patch on the vendored `sandbox-agent` package adds a
  native "reload this session" call, so a restarted sandbox resumes the harness where it left
  off, with transcript replay as the fallback.

So on paper, a follow-up turn should restart the parked sandbox and pick up the conversation.
In practice it does not, for the reason below.

## Why it still fails

The runner asks for the right behavior, but the piece that carries it out is missing.

The code that talks to Daytona is called the *provider*. The runner's park and reconnect calls
depend on two provider functions: one to pause (stop) a sandbox, and one to reconnect to a
stopped one. The Daytona provider implements neither. As a result:

- `pauseSandbox()` finds no pause function and falls through to a plain delete. The sandbox is
  gone at turn end, `keepWarm` or not.
- The reconnect call finds a deleted sandbox id and cannot revive it, so the runner builds a
  fresh sandbox anyway.

The net effect is a full rebuild on every turn, exactly what F-020 reported. `research.md`
walks the code that proves each step.

## The key finding

The warm-reuse machinery is mostly written already and sitting untested in the working tree.
What blocks it is small and specific: two missing functions in the Daytona provider, plus a few
correctness gaps around them that a design review surfaced. This project is a takeover. Verify
the existing code, add the two functions, close the gaps, decide how the runner cleans up
abandoned sandboxes, and decide how far to push reuse.

Two older facts are worth carrying forward, because a later decision depends on them:

- The Daytona sandbox used to be created `ephemeral: true`, which auto-deleted it the moment it
  stopped. That was a safety backstop: a crashed runner could not leave a sandbox billing for
  long. Switching to `ephemeral: false` removes that reflex, so the plan has to answer what now
  cleans up an abandoned sandbox.
- The local (non-Daytona) sessions already get warm reuse from an in-memory pool, but that pool
  is deliberately kept off Daytona. A leaked local session costs only host memory; a leaked
  Daytona sandbox costs real money. `research.md` covers the pool in full.

## Goals

- Make a second Daytona turn in the same conversation near-instant while the conversation is
  active (the sandbox stays running for a short window), and cheap to resume after the window
  closes (restart the stopped sandbox instead of rebuilding).
- Keep the parked cost honest and bounded, as configuration with measured, conservative defaults:
  storage only for a stopped sandbox, a short window and a hard cap on concurrently running
  parked sandboxes.
- Never leak a running sandbox. Cleanup of abandoned sandboxes has to be at least as safe as the
  `ephemeral: true` behavior it replaces.
- Reuse the existing local keepalive pool logic (`session-pool.ts`), refactored to be
  provider-aware, instead of building a second pooling mechanism.
- Keep durable continuity (PR #5197) as the always-correct fallback.

## Non-goals

- Fixing the Daytona tool-call hang (F-018, a separate bug with its own implementation workspace,
  `daytona-gate-delivery`). Warm reuse helps chat first. Tool turns fail on Daytona until F-018
  lands, and a failed turn does not park.
- Routing across multiple runner replicas. The runner is single-replica; a miss just falls back
  to a cold build.
- Changing the wire contract, the SDK, or the frontend. This is a runner-only change.
- Running the full app path against live Daytona during this design pass. One credit-controlled
  lifecycle measurement was run directly against the Daytona API on 2026-07-11 (two sandboxes,
  created and deleted, numbers in research.md); end-to-end verification through the app is the
  plan's final slice, not done here.

## Who is affected

Anyone running a multi-turn chat agent on Daytona through the deployed app. Today they wait
about twenty seconds per turn. The build-kit default agent feels it most, because its "read the
skill first" instruction makes the model open with a tool call. That path is currently blocked
by F-018 rather than by build latency, so it will not benefit until F-018 lands.
