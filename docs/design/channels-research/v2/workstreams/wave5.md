# Wave 5 → C5

Runs from C4 to C5 as one cycle:

```text
CU-A  →  packages ⇄ merges  →  final merge  →  CU-B  →  deploy  →  CU-C  →  C5
```

The packages phase is a **graph**: it may fan out, converge, and merge several times
along the way. Intermediate merges are rebase points only. **Only the final merge
earns CU-B, deploy and CU-C** — a seam cannot be verified until both sides have
landed, and a stack is not worth deploying twice for one checkpoint.

**Exit condition:** an operator creates a bot in the UI, opens a conversation, sends
a message, gets an answer, and clicks a choice — travelling the public ingress, the
inbox, a detached invoke, session events, the outbox, and back — with **no platform
credentials**. `poll_turn` is gone from the tree.

That is C4's unmet exit condition, plus a surface to drive it from.

**Why Agenta first.** It needs no external account, so the whole path is provable on
a laptop. Slack then proves the port holds rather than shaping it — which is what
happened the first time round. Slack's own credentials are C6's business.

**What C5 does not claim.** No Slack message has travelled the path. The connections
write path is generic, so a Slack connection *can* be created by API once WP23
lands, and checking that during CU-C is worthwhile — as a diagnostic, not a gate.

## CU-A — before any package

Two kinds of debt, both of which corrupt the packages if left. Ledger:
`tasks-cu-wave5.md`.

**The guards that lie.** Each reads as coverage it does not provide, and packages
get written against them:

- the keyword-only AST check walks `AsyncFunctionDef` only and asserts a hardcoded
  count, so it cannot see the one sync method on the interface (`F48`)
- `worker_queues.py` builds a queue with no producer, and its registry never got the
  mock adapter (`F42`, `F43`)
- Slack bypasses `normalise_capabilities` entirely — `model_validate` direct — so
  its declaration is never clamped, and it declares `text.max_chars: 4000` where
  `capabilities.md` says 3000
- `space_locator` and `thread_locator` are written by every adapter and read by
  none, with a filed bug in one that therefore cannot bite (`F50`, `F28`)

**The reconciliation debt.** Five documents carry superseded material and still read
as current. Package specs are written from these, so this is a prerequisite:

| document | superseded on |
| --- | --- |
| `entities.md` §1 | the connection is reused, no channels-specific columns |
| `entities.md` §2.5 | grants are instance-level only |
| `provisioning.md` | credentials encrypted on the connection; the Slack setup shape |
| `capabilities-v2.md` §1 | the credential schema as a new field-list mechanism |
| `architecture.md` §8.1 | "there is no shared vendor app to compromise" — there will be |

## Packages

| Spec | Tasks | Package | Depends on |
| --- | --- | --- | --- |
| [specs-wp0.md](specs-wp0.md) | [tasks-wp0.md](tasks-wp0.md) | Session events | — |
| [specs-wp21.md](specs-wp21.md) | [tasks-wp21.md](tasks-wp21.md) | The adapter interface | — |
| [specs-wp22.md](specs-wp22.md) | [tasks-wp22.md](tasks-wp22.md) | Schema: connections, grants, secrets | WP21 |
| [specs-wp23.md](specs-wp23.md) | [tasks-wp23.md](tasks-wp23.md) | The connections write path | WP22 |
| [specs-wp24.md](specs-wp24.md) | [tasks-wp24.md](tasks-wp24.md) | The Agenta channel | WP21, WP23 |
| [specs-wp25.md](specs-wp25.md) | [tasks-wp25.md](tasks-wp25.md) | The Agenta surface | WP24 |
| [specs-wp20.md](specs-wp20.md) | [tasks-wp20.md](tasks-wp20.md) | Inbound actions | WP24 |

### Merge points

The packages phase is a graph, not one fan-out. It has **intermediate merges**, and
each one is a rebase point and nothing more — **only the final merge earns CU-B,
deploy and CU-C.**

```text
WP0 ─────────────────────────────────────────────┐  (independent, day one)
                                                 │
WP21 ──M1── WP22 ──M2── ┬─ WP23 ─┐               │
                        └─ WP24 ─┴─M3── ┬─ WP25 ─┼──M4 ── CU-B → deploy → CU-C
                                        └─ WP20 ─┘
```

| | merges | then |
| --- | --- | --- |
| **M1** | WP21 — the interface | everyone rebases; the file is frozen again |
| **M2** | WP22 — schema | WP23 and WP24 branch from it |
| **M3** | WP23, WP24 | WP25 and WP20 branch from it |
| **M4** | WP25, WP20, WP0 | **the final merge** — CU-B, deploy, CU-C |

**Why serial at the top.** WP21 changes a frozen interface and WP22 changes the
migration; building either against the other unmerged means every later package
inherits two moving foundations. The stubs-first pattern in [README.md](README.md)
exists for *interface* dependencies — these are behavioural, so they merge first.

**Why WP23 and WP24 pair.** WP24's adapter needs only WP21 and WP22 to be written,
but its acceptance test needs a connection to exist, which is WP23's route. They
develop in parallel against the route contract and land together at M3.

**WP0 carries forward unchanged** — its spec is from wave 3 and the work never
happened (`F3`). It depends on nothing here and starts on day one. It may merge at
any point; landing it by M3 lets CU-B verify the outbox consumes events rather than
polls.

**WP21 and WP22 are the bottleneck** and are one person's first move. If they slip,
the wave slips — WP0 is the hedge, being the only package that cannot be blocked by
them.

### At an intermediate merge

Rebase and carry on. No deployment, no acceptance run, no CU phase. What *is* worth
doing, because it is cheap and the alternative is finding it at M4:

- the branch builds and its own suite passes on the merged base
- the reachability check for **that package's** new symbols only

The full check is CU-B's, at M4, because a seam between two packages cannot be
checked until both have landed.

## File ownership

New and changed, on top of the table in [README.md](README.md):

| WP | Owns |
| --- | --- |
| WP20 | `core/channels/adapters/slack/mapping.py` (actions), the action event kind |
| WP21 | `core/channels/adapters/interface.py`, `adapters/normalise.py`, the contract suite |
| WP22 | the migration, `dbs/postgres/channels/dba*.py`, `core/channels/dtos.py`, `core/secrets/{enums,dtos}.py` |
| WP23 | `apis/fastapi/channels/{router,models}.py` (connections routes only), `core/channels/service.py` (connections) |
| WP24 | `core/channels/adapters/agenta/`, `middlewares/auth.py` |
| WP25 | `web/oss/src/…` (own repo area entirely) |

### Collisions

| File | Who | Handling |
| --- | --- | --- |
| `core/channels/adapters/interface.py` | WP21 alone, everyone reads | **This wave's checkpoint conversation.** Frozen again at M1; no package edits it afterwards. |
| the migration `oss000000021` | WP22 alone | Edited **in place**, nothing being released. WP23 and WP24 read the result, never add a revision. |
| `core/secrets/` | WP22 alone | One enum member, one inner enum, one discriminator branch. Nothing else in that domain is touched. |
| `middlewares/auth.py` | WP24 alone | Four lines for `/channels/agenta/events/`, trailing-slashed, exactly as the Slack and bridge entries are written. |
| `api/entrypoints/routers.py` | WP23, WP24 | **Serialised at M3**, where both land. Each prepares a diff; applied in order, never edited mid-stream. This is the one file the merge-point structure does not spare — both packages need it and they merge together. |
| `core/channels/service.py` | WP22, WP23 | WP22 takes the DTO and grain changes; WP23 takes the connections methods. Land WP22 first and WP23 rebases. |

## CU-B — after the final merge (M4), before deploy

**The reachability check is the point.** Every symbol any package introduced gets
grepped for callers outside its own module. Intermediate merges checked each package
alone; this is where the seams between them get checked. Green merges have hidden four
disconnections twice, and a passing suite is not evidence that two packages meet.

Specifically: the Agenta adapter registered in **every** composition root, not one;
the `_PUBLIC_ENDPOINTS` lines present in all four spellings; the connections routes
mounted; the outbox consuming session events rather than polling.

## Deploy

A checkpoint activity, and not mine to run.

## CU-C — what the deployment finds

The first integration run against a real stack found four defects last time. Budget
for it rather than treating it as slack. Ledger: the same `tasks-cu-wave5.md`.

Worth attempting here, as a diagnostic rather than a gate: create a Slack connection
through WP23's generic write path, paste real credentials, and DM the bot. Grants by
kind land in WP22, so DMs should work for the first time. If Slack is broken in some
new way, wave 6 learns it before building a setup UI on top.

## C5 is reached when

- A bot is created in the UI, a conversation is opened, a message is answered, and a
  choice is resolved by clicking — no platform credentials anywhere.
- `poll_turn` does not exist in the tree.
- The route is public and the adapter refuses a bad credential with a bare 401.
- Nothing between the inbox row and the posted answer branches on the channel.
