# Wave 2 intermediate merges

| Node | Inputs | Review focus |
| --- | --- | --- |
| `IM-2-00` | `WP-2-00` | The port shapes and the field roles, before two branches build against them. Whether a flag-off deployment is provably unchanged. Whether the component key vocabulary can carry MCP and sandbox time without a second envelope. |
| `IM-2-01` | `WP-2-01`, `WP-2-02` | Whether the emitted measurement is complete enough to price: the cache split, `secret_origin`, the run dimension, and whether the non-streaming path records at all. The rate card's arithmetic and rounding, and that no pricing ran on the request path. |
| `IM-2-02` | `IM-2-01`, `WP-2-03`, `WP-2-04` | The full chain in one process: admission before dispatch, the refusal path, the composition root's flag behaviour, and one call producing exactly one posting. This is the deployment node. |

Each IM takes its own worktree and throwaway branch, on each branch it merges. It is a
reviewed fan-in, not a fast-forward.

**An IM that spans both branches reviews both diffs together and merges them in dependency
order: gateway first, wallet second.** The wallet side imports gateway-declared ports, so a
wallet commit reviewed against an unmerged gateway commit is reviewing a guess.
