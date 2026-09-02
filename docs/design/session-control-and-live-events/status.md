# Status

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

## Current state

- Isolated branch created: `agent/session-execution-rfc`.
- Problem inventory created from 48 open GitHub issues.
- Current Stop, heartbeat, records, and watch paths checked against the repository.
- Confirmed process decisions recorded.
- Proposed architecture choices kept separate from confirmed decisions.
- Living RFC created with empty sections for track-by-track discussion.
- Current command endpoint and runner routing boundary verified.
- Sandbox-agent cancellation investigation promoted to the first parallel task.
- Five seconds recorded as the provisional Stop delivery target.
- Public resource API separated from the proposed internal command transport.
- Current interaction response path documented.
- Public APIs from Gumloop, OpenAI background Responses, and Claude Managed Agents compared.
- Each current operation mapped to its proposed behavior and degree of change.
- Stop and Delete distinction confirmed.
- Optional `expected_execution_id` guard recorded.
- One public session API for first-party and external clients recorded.
- Visible server-side pending inputs added to the interface discussion.
- Queued inputs made immutable. Clients can remove and replace them, but cannot edit or reorder.
- Detailed API mechanics delegated to established conventions unless they affect architecture.
- Durable acceptance defined independently from runner claim and execution start.

## Branch

- Branch: `agent/session-execution-rfc`
- The branch is pushed to `Agenta-AI/agenta` after each design exchange.

## Next discussion

Start with **Stop and ownership**:

1. Start the sandbox-agent capability investigation.
2. Confirm the user-visible Stop requirements and latency target.
3. Choose the immediate runner-control transport at a high level.
4. Define terminal settlement and watchdog responsibility.
5. Decide which current issues this track is expected to close.

The **live-frame ingress** discussion can proceed independently after that or in parallel.
