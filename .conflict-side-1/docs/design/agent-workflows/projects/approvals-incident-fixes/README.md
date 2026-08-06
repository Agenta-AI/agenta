# Concurrent approvals incident fixes

This workspace plans the fixes for the concurrent human-approval failure observed in live
session `db58551b` on 2026-07-19, plus the session-turns counter bug found in the same logs.
The incident and its seven defects are documented and log-verified in
`docs/design/agent-workflows/scratch/debug-concurrent-approvals-db58551b.md`; the design
principles we adopt from Zed's handling of the same problem are in
`docs/design/agent-workflows/scratch/zed-acp-approvals-comparison.md`; the counter bug is in
`docs/design/agent-workflows/scratch/debug-session-turns-append-500.md`.

## Reading order

1. `context.md` explains why this work exists, what it must achieve, and what is
   deliberately out of scope.
2. `research.md` holds the code-verified findings (R1 through R8) that the plan is built
   on, with file and line evidence for every claim, and a prominent list of open risks.
3. `plan.md` is the implementation plan: five ordered steps, each with exact files,
   behavioral contracts, acceptance criteria, and test commands. Each step is independently
   landable. The implementer is expected to work from this file without having read the
   incident conversation.
4. `qa.md` is the live QA script that reproduces the incident shape against the dev stack
   and states the expected correct behavior at each point.
5. `status.md` tracks where the project stands.

## Glossary

Every domain term used in this workspace, one line each.

- **Runner**: the Node/TypeScript sidecar under `services/runner/` that drives a coding-agent
  harness inside a sandbox and streams events to the web UI.
- **Harness**: the agent program that implements the model-and-tool loop, such as Pi
  (`pi_core`) or Claude Code (`claude`). The runner talks to it over ACP, the Agent Client
  Protocol.
- **Gate**: a human-approval request. When the harness wants to run a permission-gated tool,
  the runner shows the user an approval card and waits for allow or deny.
- **Park**: ending the browser-facing turn while an unanswered gate keeps the live harness
  process waiting. The answer arrives in a later request.
- **Warm resume**: continuing a parked session in place. The runner checks the live process
  out of the keepalive pool and answers the original permission request by its id, so the
  approved tool runs with its original arguments.
- **Keepalive pool**: the runner's bounded collection of live parked sessions, each with a
  time-to-live limit after which it is destroyed.
- **Records**: the durable per-session event stream. The runner posts every agent event to
  the API's record-ingest endpoint; the frontend rebuilds a conversation from these rows
  (that rebuild is called hydration).
- **Interactions**: the durable table of human-in-the-loop requests. Each gate creates one
  interaction row with a lifecycle status (pending, responded, resolved, cancelled).
- **Turns**: the append-only `session_turns` table. One row per completed conversation turn,
  carrying the harness's native session id so a restarted runner can resume the conversation
  natively instead of replaying text.
