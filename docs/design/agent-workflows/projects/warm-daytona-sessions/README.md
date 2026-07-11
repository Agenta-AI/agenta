# Warm and resumable Daytona sessions

## What this project is about

When you chat with an agent that runs on Daytona, every message waits about fifteen seconds before
the agent starts to answer. That wait is the whole per-turn setup being redone from scratch, once
per message: build a cloud machine, install and start the agent inside it, mount its files, reload
the conversation, even though the previous turn already did all of that. This workspace plans how
to reuse the running setup between turns so the second message, and every message after it, starts
fast. It is a design plan only. No code ships in this pull request.

A few words you will meet throughout, defined once:

- **Sandbox:** the isolated cloud machine an agent runs in. On Daytona it is a billed resource.
- **Daytona:** the cloud provider that hosts these sandboxes.
- **Runner:** the Agenta service that drives one agent turn. It builds the sandbox, runs the turn
  inside it, and tears it down.
- **Harness:** the agent program that runs inside the sandbox (Claude Code or Pi).
- **Park a sandbox:** stop it but keep its disk, so the next turn can restart the same one instead
  of rebuilding it. This is the whole idea behind the project.

## Read the files in this order

1. **context.md.** What a user sees today, what recent work already tried, why it still fails, and
   the finding that shaped the first draft: the code to keep a sandbox warm was already written,
   but the piece of it that talks to Daytona is missing two functions it needs.
2. **research.md.** The current code, function by function, with the exact reasons warm reuse does
   not work yet, plus the measured Daytona lifecycle numbers and prices (2026-07-11) that reshaped
   the plan. Read this for the evidence behind context.md.
3. **plan.md.** The proposal: one progressive sequence of slices from the correctness base through
   park-to-stopped and a provider-aware pool refactor up to park-to-running. Its section "The
   three resume paths, compared" prices fresh create, stop-then-restart, and kept-running from
   the measured stages; start there if you only want the decision.
4. **open-questions.md.** What still needs a human: three correctness decisions for a reviewer and
   two proposed defaults to confirm. The former cost questions are answered by the measurement.
5. **status.md.** Where the project stands, what was decided and why, the measurement summary, and
   what the two design-review rounds changed.

## The recommendation, in one paragraph

Build the whole ladder in slices, each shippable on its own. First the correctness base (the two
missing Daytona provider functions plus the leak and race fixes two design-review rounds found,
gated behind a default-off flag from the start), then park-to-stopped (stop the sandbox at turn
end instead of deleting it; parked cost is disk storage only, about $0.0009/hour), then a refactor
that makes the existing local keepalive pool provider-aware, then park-to-running (keep the
sandbox running for a short window after each turn, default 60 seconds with a hard cap of 4
concurrently running sandboxes enforced before creation, about $0.0028 per parked minute), and
finally credit-controlled live verification before any flag flips on. The measurements behind
this order: creating a Daytona sandbox takes about 1 second of a measured ~15-second turn; the
rest is our own per-turn setup, stage by stage in research.md, and only a sandbox that stays
running skips it (a resumed turn is roughly 2 to 3 seconds, estimated). The archive state is
dropped entirely (restoring from archive is slower than creating fresh). Today's always-correct
fallback (rebuild and replay the transcript) stays underneath everything.

## Related workspaces

- `docs/design/agent-workflows/projects/session-keepalive/`: the local, in-memory pool that already
  gives non-Daytona sessions warm reuse. This project refactors that pool to be provider-aware;
  its once-deferred Daytona slice is this project's park-to-running level.
- `docs/design/agent-workflows/projects/harness-session-resume/`: how a restarted sandbox reloads the
  past conversation. This is the fallback both levels rely on.
- `docs/design/agent-workflows/projects/daytona-gate-delivery/`: the F-018 fix (approval gates on
  Daytona), in implementation. This plan follows its pending-approval resume model.
- `docs/design/agent-workflows/projects/qa/findings.md`: the QA findings referenced here. F-020 (this
  slow-turn problem), F-018 (a separate Daytona bug that hangs tool calls), and F-017 (a mount bug
  already fixed).
