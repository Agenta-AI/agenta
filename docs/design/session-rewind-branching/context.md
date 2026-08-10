# User experience and scope

## What the user sees today

The playground lets a user rewind from an earlier user or assistant message. Before pull request
5860, rewind changed only the browser transcript. The session ID stayed the same.

That produced a visible failure:

1. The browser removed the later messages.
2. The durable record log still held those messages under the same session ID.
3. A later hydration fetched the complete record log.
4. The removed messages reappeared.

The runner created a second, less visible failure. A warm harness session, or a cold harness session
restored through native continuity, still remembered the later turns. Even if the browser hid those
turns successfully, the agent could answer using information the user believed they had removed.

## User story

As an agent playground user, I want to rewind to a selected turn and continue in another direction
without later turns reappearing or influencing the new response. I also want the original
conversation to remain available, so rewind never destroys prior work.

For a durable product experience, the same branch should reopen correctly after a page reload, a
local storage clear, or a switch to another browser or device.

## Pull request 5860 behavior

Pull request 5860 changes rewind into a new-session fork:

```text
Original session A
Turn 1 -> Turn 2 -> Turn 3 -> Turn 4

Rewind before Turn 3

Original session A
Turn 1 -> Turn 2 -> Turn 3 -> Turn 4

Fork session B
Turn 1 -> Turn 2 -> new Turn 3
```

The browser closes session A's tab but keeps A in History. It creates session B, copies the retained
messages into browser storage, and makes B active. The first request for B sends the full retained
history because B has no records or native harness continuity. Later requests send only the newest
user message.

## Goals for pull request 5860

- Stop removed messages from returning in the same browser.
- Ensure the new runner session receives the retained context on its first request.
- Preserve the complete original session in History.
- Survive a reload between rewind and the first send.
- Retry correctly when the first branch request fails or is aborted.
- Restore whether the fork should reopen an editable prompt or rerun a prompt automatically.
- Preserve a meaningful session title.
- Add no backend schema migration.

## Non-goals for pull request 5860

- Durable branch lineage across devices.
- A branch tree UI.
- Copying or snapshotting a sandbox filesystem.
- Undoing external tool side effects.
- Changing append-only record persistence.
- Adding parent fields to every record.
- Fixing the package-level rewind implementation in `@agenta/chat`.

## Goals for the later durable branching project

- Store the parent session and inherited effective-turn count on the server.
- Reconstruct a branch from parent records plus its own records.
- Let the frontend and runner use one server-owned effective transcript.
- Preserve titles, descriptions, and branch provenance across devices.
- Avoid copying parent records into every child branch.
- Keep one frontend transcript request per opened session.

## Separate client-tool replay defect

The `request_input` replay defect discussed during this review is valid but independent. A preceding
ACP tool call may carry `{}` before the interaction request carries the real form input. Both
transcript mapper copies retain `{}` because they update only an `undefined` input. That causes the
elicitation form parser to degrade. It should be fixed in a separate commit or pull request with
parity tests in the OSS and `@agenta/chat` copies. It does not change the rewind data model.
