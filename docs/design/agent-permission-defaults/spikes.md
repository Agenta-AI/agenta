# Claude and Codex permission spikes

## Purpose

Determine how to provide unattended Bash and file edits while preserving explicit
platform approvals. The shared new-agent default changes to Allow now. Native modes
and adapters remain unchanged until evidence supports a separate implementation.

## Matrix

Run the same checks independently for Claude and Codex. Record image versions, harness
versions, environment, authentication mode, settings, actual tool events, and side effects.

| Dimension | Checks |
| --- | --- |
| Native tools | Shell command, file read, write, and edit; ACP gate presence |
| General policy | Allow, Allow reads, Ask, Deny; conflicting explicit policies |
| Native settings | Claude modes/rules and loaded settings; Codex modes/preset overrides |
| Platform Ask | Approve, deny, abandon; no side effect before authorization |
| Resume | Warm process, cold reconstruction, session isolation, duplicate decisions |
| Authorization | Exact arguments, changed arguments, replay, forged relay requests |
| Environment | Local and Daytona where available; managed and subscription auth |

Do not touch customer resources or change shared deployment configuration. Use isolated
test accounts and harmless temporary files. Do not publish secrets or raw credentials.
Use existing repository tests and release-gate scripts before adding any new harness.

## Reports

Each report records tested, source-only, and blocked cells. Include commands, outcome,
minimal evidence, limitations, and a recommendation. Do not label unexecuted cells passed.
Use `claude-spike.md` and `codex-spike.md` for separate findings.
