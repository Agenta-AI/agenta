# Agent config editing

An agent in the Agenta playground can edit its own configuration. Today every edit must
resend the full content, which wastes tokens, breaks above ~4.8 KB, and silently replaces
whole lists. This project replaces that with targeted operations, and refactors the runner
so small configuration changes stop forcing a full sandbox rebuild.

## Reading order

| File | Answers |
|---|---|
| `context.md` | Why this work exists. Goals, non-goals, user stories. |
| `plan.md` | The execution plan: slices, order, QA gates. |
| `status.md` | Where the work stands right now. Decisions and blockers. |
| `contracts/change-set.md` | The change-set engine, decided. Where any other document disagrees with it, this one wins. |
| `contracts/execution-authorization.md` | Execution authorization for workspace file references, decided. |
| `contracts/workspace-import.md` | The workspace import boundary, decided. |
| `contracts/adapter-matrix.md` | The harness reconciliation matrix, decided. |
| `contracts/commit-transaction.md` | The atomic commit transaction and its wire response, decided. |
| `contracts/read-config.md` | `read_config`, the editable scope, and the call description, decided. |
| `research.md` | What the codebase research found, with file references. |
| `research/rfc.html` | The original RFC: requirements, design questions. Historical context; the `contracts/` files carry the decided answers. |
| `research/change-set-interface-codex.md` | The pre-consolidation change-set interface spec. Historical; superseded by `contracts/change-set.md`. |
| `research/runner-lifecycle-codex.md` | The pre-consolidation runner lifecycle architecture. Historical; superseded by `contracts/adapter-matrix.md`. |
| `spikes/engine-spike.md` | Findings from the change-set engine prototype. Historical. |
| `spikes/runner-spike.md` | Findings from the runner-side spikes. Historical. |

The `contracts/` files are the implementation source of truth. `research/` and `spikes/`
record how we got there; read them for context, not for the current behavior.

## Glossary

- **Configuration**: the JSON object at `parameters.agent` in a revision. It holds the
  instructions, the model, the tools, the skills, the MCP servers, the harness, and the
  permissions.
- **Revision**: one committed version of the configuration. Revisions are immutable.
- **Harness**: the coding agent that runs inside the sandbox (Pi, Claude Code, or Codex).
- **Runner**: the TypeScript service (`services/runner`) that creates sandboxes, writes
  workspace files, opens harness sessions, and executes turns.
- **Sandbox**: the isolated machine (local process or Daytona VM) the harness runs in.
- **Warm session**: a sandbox plus harness session the runner keeps alive between turns.
- **Fingerprint**: today, one checksum over all configuration values. The runner compares
  it to decide whether a parked warm session can be reused.
- **Builder tools**: platform tools (commit_revision and others) injected into playground
  runs only, never stored in the configuration.
- **Change set / delta**: the payload of a commit: what to change relative to a base.
