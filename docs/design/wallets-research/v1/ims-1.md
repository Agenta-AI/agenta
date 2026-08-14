# Wave 1 intermediate merges

| Node | Inputs | Review focus |
| --- | --- | --- |
| `IM-1-00` | `WP-1-00` | Shared DTO/port seed commit, ownership boundaries, and fixture usability before implementation worktrees fork. |
| `IM-1-01` | `WP-1-01`, `WP-1-02` | Schema/API boundary, stream envelopes, migration safety, and unit/integration results before connecting the workers. |
| `IM-1-02` | `IM-1-01`, `WP-1-03` | End-to-end worker wiring, idempotency, ACK/retry behavior, and readiness for final cleanup/deployment. |

Each IM has its own worktree and throwaway branch. It is a reviewed fan-in, not a fast-forward of a
feature branch.
