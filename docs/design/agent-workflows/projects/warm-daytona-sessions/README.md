# Warm and resumable Daytona sessions

## What this project is about

When you chat with an agent that runs on Daytona, every message waits about twenty seconds before
the agent starts to answer. That wait is a fresh cloud machine being built from scratch, once per
turn, even though the previous turn already built one. This workspace plans how to reuse that
machine between turns so the second message, and every message after it, starts fast. It is a
design plan only. No code ships in this pull request.

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
   the finding that shaped the whole plan: the code to keep a sandbox warm was already written, but
   the piece of it that talks to Daytona is missing two functions it needs.
2. **research.md.** The current code, function by function, with the exact reasons warm reuse does
   not work yet. Read this for the evidence behind context.md. It also covers the local warm-reuse
   pool and how Daytona bills a stopped sandbox.
3. **plan.md.** The proposal. Two levels of reuse, the work each needs, the gaps to close first, and
   a recommendation. Start here if you only want the decision.
4. **open-questions.md.** The decisions that still need a human: a reviewer for the correctness ones,
   a billing owner for the cost ones.
5. **status.md.** Where the project stands, what was decided and why, and what the design review
   changed.

## The recommendation, in one paragraph

Ship the cheaper level first. Park-to-stopped stops the sandbox at the end of a turn and restarts
the same one on the next turn; its parked cost is disk storage only. Put it behind a flag that is
off by default, close the handful of correctness gaps the design review found, and turn it on after
one careful live test. Keep today's always-correct fallback (rebuild the sandbox and replay the
transcript) underneath it. Defer the more expensive level, park-to-running, which keeps the sandbox
running between turns, until a billing owner sets its cost limits.

## Related workspaces

- `docs/design/agent-workflows/projects/session-keepalive/`: the local, in-memory pool that already
  gives non-Daytona sessions warm reuse. Its deferred Daytona slice is this project's park-to-running
  level.
- `docs/design/agent-workflows/projects/harness-session-resume/`: how a restarted sandbox reloads the
  past conversation. This is the fallback both levels rely on.
- `docs/design/agent-workflows/projects/qa/findings.md`: the QA findings referenced here. F-020 (this
  slow-turn problem), F-018 (a separate Daytona bug that hangs tool calls), and F-017 (a mount bug
  already fixed).
