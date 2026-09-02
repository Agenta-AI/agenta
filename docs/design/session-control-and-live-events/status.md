# Status

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

## Current state

- Isolated branch created: `agent/session-execution-rfc`.
- Problem inventory created from 48 open GitHub issues.
- Current Stop, heartbeat, records, and watch paths checked against the repository.
- Confirmed process decisions recorded.
- Proposed architecture choices kept separate from confirmed decisions.
- Living RFC created with empty sections for track-by-track discussion.

## Blockers

- GitHub CLI is unavailable in the environment. The isolated checkout uses standard Git.
- The branch exists only locally. It has not been committed or pushed.

## Next discussion

Start with **Stop and ownership**:

1. Confirm the user-visible Stop requirements and latency target.
2. Verify the sandbox-agent cancellation limitation.
3. Choose the immediate runner-control transport at a high level.
4. Define terminal settlement and watchdog responsibility.
5. Decide which current issues this track is expected to close.

The **live-frame ingress** discussion can proceed independently after that or in parallel.
