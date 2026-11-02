# Wave 1 work packages

| Node | Depends on | Scope | Output |
| --- | --- | --- | --- |
| `WP-1-00` | — | Shared stream DTOs, ports, errors, and test fixtures; no implementation bodies. | Seed commit from which every implementation node forks. |
| `WP-1-01` | `IM-1-00` | EE core wallet schema, non-strict `check`, and atomic debit settlement. | `core_ee` migration plus core service and tests. |
| `WP-1-02` | `IM-1-00` | Wallet-owned fake LLM/MCP producer, measurement persistence, debit-message production, and all stream-worker registration. | `tracing_ee` migration plus `streams:measurements` chain. |
| `WP-1-03` | `IM-1-01` | Debit-stream consumer wired to the core settlement service. | `streams:debits` worker plus duplicate-delivery tests. |

`WP-1-01` and `WP-1-02` are independent only after the reviewed seed commit. Every WP receives its
own worktree and throwaway branch. Their specifications and tasks are under `nodes/`.

```text
WP-1-00 → IM-1-00 ─┬→ WP-1-01 ─┐
                    │             ├→ IM-1-01 → WP-1-03 → IM-1-02 → CU-1-01
                    └→ WP-1-02 ─┘
```
