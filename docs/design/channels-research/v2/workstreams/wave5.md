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
credentials**.

That is C4's unmet exit condition, plus a surface to drive it from.

**Why Agenta first.** It needs no external account, so the whole path is provable on
a laptop. Slack then proves the port holds rather than shaping it — which is what
happened the first time round. Slack's own credentials are C6's business.

**What C5 does not claim.** No Slack message has travelled the path. The connections
write path is generic, so a Slack connection *can* be created by API once WP23
lands, and checking that during CU-C is worthwhile — as a diagnostic, not a gate.

## CU-A — done

Two kinds of debt, both of which corrupt the packages if left. Ledger:
`tasks-cu-wave5.md`.

**The guards that lie.** Fixed here: the three composition roots that each built
the adapter registry by hand and had drifted, now one factory; the queue with no
producer, removed; the two per-grain locators nothing read, deleted; the backfill
locator, which turned out to be a live defect rather than a dead one.

Two moved to **WP21**, which owns those files and is about to change them: the AST
guard that cannot see a sync method, and the normaliser Slack bypasses.

**The reconciliation debt.** Five documents carried superseded material and read as
current. All five now say what changed; `architecture.md` §8.1 was rewritten rather
than annotated, because it claimed a security posture that only one of two
installation models will have.

**What it found.** WP0 was already done — the wave listed it as never having
happened.

## Packages

| Spec | Tasks | Package | Depends on |
| --- | --- | --- | --- |
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
WP21 ──M1── WP22 ──M2── ┬─ WP23 ─┐
                        └─ WP24 ─┴─M3── ┬─ WP25 ─┬──M4 ── CU-B → deploy → CU-C
                                        └─ WP20 ─┘
```

| | merges | then |
| --- | --- | --- |
| **M1** | WP21 — the interface | everyone rebases; the file is frozen again |
| **M2** | WP22 — schema | WP23 and WP24 branch from it |
| **M3** | WP23, WP24 | WP25 and WP20 branch from it |
| **M4** | WP25, WP20 | **the final merge** — CU-B, deploy, CU-C |

**Why serial at the top.** WP21 changes a frozen interface and WP22 changes the
migration; building either against the other unmerged means every later package
inherits two moving foundations. The stubs-first pattern in [README.md](README.md)
exists for *interface* dependencies — these are behavioural, so they merge first.

**Why WP23 and WP24 pair.** WP24's adapter needs only WP21 and WP22 to be written,
but its acceptance test needs a connection to exist, which is WP23's route. They
develop in parallel against the route contract and land together at M3.

**WP0 is not in this wave, and the earlier claim that it never happened was
wrong.** CU-A checked: both publishes, the stream consumer and the outbox's
turn-event handler are merged and wired, and `poll_turn` exists nowhere in the
tree. That removes the one branch of this graph that could have run in parallel
with the top of it.

**WP21 and WP22 are the bottleneck**, and with WP0 gone there is no longer a hedge
against them slipping. If they slip, the whole wave slips.

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
| `apis/fastapi/channels/router.py` and `api/entrypoints/routers.py` | WP23, WP24 | **Serialised at M3**, where both land. Each prepares a diff; applied in order, never edited mid-stream. The two files the merge-point structure does not spare — both packages need them and they merge together. |
| `core/channels/service.py` | WP22, WP23 | WP22 takes the DTO and grain changes; WP23 takes the connections methods. Land WP22 first and WP23 rebases. |

## CU-B — after the final merge (M4), before deploy

**The reachability check is the point.** Every symbol any package introduced gets
grepped for callers outside its own module. Intermediate merges checked each package
alone; this is where the seams between them get checked. Green merges have hidden four
disconnections twice, and a passing suite is not evidence that two packages meet.

Specifically: the Agenta adapter reaching every composition root through the shared
factory rather than any root building its own registry again; the
`_PUBLIC_ENDPOINTS` lines present in all four spellings; the connections routes
mounted; the outbox still consuming session events rather than polling.

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
- The outbox is driven by session events. Already true on entry — WP0 landed in
  wave 3 and `poll_turn` is gone; CU-B re-checks it rather than building it.
- The route is public and the adapter refuses a bad credential with a bare 401.
- Nothing between the inbox row and the posted answer branches on the channel.
