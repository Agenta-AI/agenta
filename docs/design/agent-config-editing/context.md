# Context

## What happens today

You build an agent by talking to it in the playground. The agent edits its own
configuration through a platform tool, `commit_revision`. The tool takes a change:
`set` (a partial object, deep-merged) and `remove` (dotted paths to delete). The merge
recurses into objects only. Scalars and lists are replaced whole.

Four consequences drive this project:

1. **Every edit is a full rewrite.** The instructions are one string. Skills, tools, and
   MCP servers are lists. To fix a typo, the agent resends the whole file. To change one
   skill, it resends every skill with every bundled file.
2. **Large payloads fail.** Tool-call arguments above ~4.8 KB arrive truncated on the
   Claude harness (issue #5554). A downloaded skill folder cannot be committed at all,
   because the agent must retype its full content through the tool call.
3. **Stale writes are silent.** The commit merges onto the latest committed revision. If
   someone else moved the head, the write silently overwrites their change.
4. **Any change throws away the warm session.** The runner decides warm reuse with one
   checksum over the whole configuration. Change one word, and the next turn pays a full
   rebuild: about 12.5 seconds instead of 1.4. A configuration mismatch even deletes the
   Daytona sandbox instead of stopping it.

The agent also cannot read its own configuration before it writes (issue #5186), and the
shipped guidance compensates for missing commit validation by demanding a full live test
run after every change.

## Goal

One working stacked PR set that lets an agent:

- edit one line of its instructions with an anchored text edit (US-1),
- edit one line of one skill without touching the others (US-2),
- install a large downloaded skill by pointing at its folder in the workspace (US-3),
- add or remove one tool by name (US-4),
- read its configuration, in parts, before writing (US-5),
- fail loudly and retry when the base moved, instead of overwriting (US-7),

and refactors the runner so sessions stay correct and cheap when the configuration
changes (US-8): update in place for most values, rebuild only when the harness kind or
the sandbox provider changes.

## Non-goals

- **US-6, run a change without saving it.** Moved out of scope on 4 August. The change-set
  format stays compatible so this can come back later.
- **Full approval-screen redesign.** The frontend work is minimal: show the agent's
  description on tool cards, and show name, file list, and diff on folder-commit
  approvals.
- **Push notifications to running sessions.** Correctness does not need them. Deferred.
- **A CLI in the sandbox.** Closed: it would need credentials inside the sandbox.
- **A configuration file in every workspace.** Closed: shared agents must not expose
  internals, and a stale file gives the agent no recovery action.

## Requirements

The full numbered list (R1 to R12) is in `research/rfc.html`, section 4. The short form:
edits cost tokens proportional to the change; large content moves by workspace reference;
every target has a stable address with unique names enforced at commit; stale commits
fail loudly; the agent can read its config in parts with a draft flag; everything works
on all three harnesses and both sandboxes; builder tools stay playground-only and
self-targeted; no credential enters the sandbox; no session runs a stale configuration;
the commit validates shape; builder tool calls carry an optional agent-written
description that the frontend shows.
