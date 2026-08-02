# Codex harness

This workspace plans and tracks adding OpenAI Codex as a first-class agent harness in
Agenta, next to the existing Claude and Pi harnesses.

## Glossary

These terms appear across every file here. Each is defined once, in this list.

- **Harness**: the coding-agent program Agenta runs on behalf of a user (Claude Code,
  Pi, and soon Codex). The user picks a harness per agent.
- **Runner**: Agenta's Node service (`services/runner`) that executes a harness inside a
  sandbox and streams its events back to the platform.
- **Sandbox-agent daemon**: the pinned npm package the runner talks to. It spawns the
  harness process and speaks ACP with it.
- **ACP (Agent Client Protocol)**: the JSON-RPC protocol between the daemon and a
  harness. Claude and Codex do not speak ACP natively; each sits behind a bridge
  process from Zed (`claude-acp`, `codex-acp`) that translates.
- **Park**: what the runner does when a harness asks permission for a tool call and a
  human must answer. The run pauses, the question surfaces in the UI, and the run
  resumes with the answer.
- **agenta-tools (loopback MCP server)**: the runner's internal MCP server. It is how
  Agenta-defined tools (callback tools, code tools, connected integrations) are
  delivered into a harness that has no native Agenta tool support.
- **Managed key / subscription auth**: the two credential modes. Managed means Agenta
  holds a provider API key in its vault and injects it. Subscription means the harness
  authenticates from the operator's own login state (OAuth tokens) on a mounted
  directory; the subscription sidecar performs that login.

## Reading order

1. `context.md`: why this project exists, what exists today, goals and non-goals.
2. `research.md`: the factual map of the current code on main that the design builds on.
3. `spike/findings.md`: empirical answers from the Milestone 0 spike (approvals,
   config, MCP tools, auth modes).
4. `design.md`: the proposed design (written after the spike).
5. `decisions.md`: the decision register. Every choice that is not an obvious copy of
   the existing Claude pattern is recorded here with its status (proposed / approved by
   Mahmoud / rejected). Nothing ships on a proposed-only decision.
6. `plan.md`: milestones, deliverables, and checks.
7. `status.md`: current progress and blockers. Always the latest truth.
8. `reports/`: one written report per milestone, for Mahmoud's review.
