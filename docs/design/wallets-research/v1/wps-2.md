# Wave 2 work packages

| Node | Depends on | Branch | Scope | Output |
| --- | --- | --- | --- | --- |
| `WP-2-00` | — | both | The two seam ports, their DTOs, the component key vocabulary, the null implementations, and the `check` signature change. No bodies, no wiring. | Seed commits on both branches, from which every implementation node forks. |
| `WP-2-01` | `IM-2-00` | both | Real usage capture on the gateway, and the EE sink that turns it into a `MeasurementCommandV1` on `streams:measurements`. | The measurement producer, replacing the wallet-owned fakes. |
| `WP-2-02` | `IM-2-00` | wallets | The versioned rate card and the charge calculation that replaces `calculate_fake_charge`. | Real `amount_musd` and `pricing_version` on every debit command. |
| `WP-2-03` | `IM-2-01` | both | The admission call in `relay_chat_completion`, the spending ceiling, and the EE adapter over `WalletsService.check`. | A call refused before dispatch when the wallet is spent. |
| `WP-2-04` | `IM-2-01` | both | Composition-root wiring behind the flag, the run dimension, and the acceptance path. | The seam actually bound in a running process. |

`WP-2-01` and `WP-2-02` are independent once the seed is reviewed: one produces measurements,
the other prices them, and they meet at the measurement worker. `WP-2-03` and `WP-2-04` both
follow `IM-2-01` because both need a producer that works before they can be judged.

Every node takes its own worktree and throwaway branch per branch it touches. A node that
spans both branches produces two commits, and the specification says which files go where.

```text
WP-2-00 → IM-2-00 ─┬→ WP-2-01 ─┐
                    │            ├→ IM-2-01 ─┬→ WP-2-03 ─┐
                    └→ WP-2-02 ─┘            │            ├→ IM-2-02 → CU-2-01
                                             └→ WP-2-04 ─┘
```
