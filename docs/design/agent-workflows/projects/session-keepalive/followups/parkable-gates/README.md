# Parkable gates: making Pi and client-tool approvals survive a turn

Keep-alive slice 2 makes one approval gate survive a turn boundary: the Claude ACP
permission gate. When it fires, the runner still holds something it can answer after the
turn ends, so a click resumes the exact same live tool call. The other three gates (the Pi
custom-tool relay gate, the Pi builtin gate, and the client-tool MCP pause) do not have that
property, so they stay on the slow cold-replay path.

This folder is the design for giving those three gates the same property.

## Who should read this

- Anyone extending keep-alive past slice 2.
- Anyone touching the Pi tool relay (`services/runner/src/tools/relay.ts`,
  `services/runner/src/tools/dispatch.ts`) or the internal tool MCP server
  (`services/runner/src/tools/tool-mcp-http.ts`).

## Read first

- [architecture-notes.md, Decision 6](../../architecture-notes.md) ("the approval win, for
  Claude today and Pi later"). This document is the deep dive behind that decision's future
  path paragraph.
- [how-approvals-work.md](../../../approval-boundary/how-approvals-work.md), the full gate
  model, the three gates, and the two planes (messages and interactions).

## Files

- [design.md](design.md): the full design. The parkability property, each of the three
  gates (how it pauses today, why it is not parkable, the options, the choice), how the
  result composes with keep-alive and the interactions plane, scope and ordering, and risks.
