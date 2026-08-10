# Workstreams

One pair of files per work package: `specs-wp{k}.md` (what to build) and
`tasks-wp{k}.md` (the ordered checklist to build it). They exist so a package can
be handed to someone — or to an agent in its own worktree — with no further
context than `v2/`.

`specs-*` states the target. `tasks-*` is a working document: check items off,
add what was missed. Neither carries history; the design documents in `v2/` remain
the source of truth and a spec that disagrees with them is a bug in the spec.

Clean-up work that belongs to no package goes in that wave's `tasks-cu-*.md` ledger
and is done at the checkpoint, not in a worktree.
[`tasks-cu.md`](tasks-cu.md) covered wave 3 and is closed;
[`tasks-cu-wave4.md`](tasks-cu-wave4.md) is wave 4's;
[`tasks-cu-wave5.md`](tasks-cu-wave5.md) is wave 5's.

**Each wave also has a `wave{k}.md`** stating its exit condition, cycle, package
list, file ownership and collisions. [`wave5.md`](wave5.md) is the current one.

**A wave is a cycle, not a fan-out.** Wave k runs from C(k-1) to Ck as:

```text
CU-A  →  packages ⇄ merges  →  final merge  →  CU-B  →  deploy  →  CU-C  →  Ck
```

The packages phase is a **graph**: it may fan out, converge, and merge several times
along the way. Intermediate merges are rebase points only. **Only the final merge
earns CU-B, deploy and CU-C** — a seam cannot be verified until both sides have
landed, and a stack is not worth deploying twice for one checkpoint.

CU-A unblocks the packages; CU-B catches what only appears when they meet; CU-C
catches what only a real stack shows. The history justifies all three — 13 of this
project's findings came from clean-up and verification phases against 14 from the
packages themselves, and the conflict-free green C2 merge still yielded four defects
on its first integration run.

Anything that outlives a single package — a cross-package seam, a pre-existing
defect, something blocked on a checkpoint — goes in [`../review-findings.md`](../review-findings.md),
not in a `tasks-*` ledger. A finding records what was *verified*, with file and
line; a passing suite is not evidence that two packages agree.

## The base

Everything branches from the **current upstream release branch** on
`Agenta-AI/agenta` — `release/v0.110.0` at the time of writing. Not `main`, and not
a fork.

That is where this org actually integrates: feature PRs squash-merge onto the
release branch, and the release branch merges into `main` as a true merge commit.
The two have diverged, so this is a real choice rather than a detail.

Three ways to get it wrong, all of which cost a day:

- **A fork's branches can be far behind.** On the wrong ref, `triggers`, `gateway`,
  `sessions` and `tasks/taskiq` do not exist — which is most of the house patterns
  these specs cite as precedent.
- **`big-agents` is behind on migrations**, so a revision number taken from it
  collides.
- **`main` is not where features land.** A PR based on it is reviewing against a
  tree the team is not merging into.

Check before branching: the migration head must be `oss000000020`, so WP1 takes
`oss000000021`. If it is not, the base is wrong and every revision number here
shifts. Re-read the release branch name when starting — it advances.

## Working in parallel

Every package runs in its **own git worktree**, branched from the same base, and
merges back through review. The dependency graph in `plan.md` says what needs what;
this section says how to start before your dependency is finished.

### Stubs-first, on the shared branch

The dependencies between packages are almost entirely **interface** dependencies:
WP4 needs the DAO's method signatures, not its implementation. So the interfaces
land first, on the base branch, before any worktree starts:

1. **Seed commit** — `core/channels/interfaces.py`, `dtos.py`, `types.py` (which
   carries the exceptions, per `entities.md` §5) and
   `core/channels/adapters/interface.py`, all complete and all raising
   `NotImplementedError`. This is WP1's and WP2's declared surface, taken verbatim
   from `entities.md` §4–§7 and `capabilities.md`.
2. **Every worktree branches from that commit.** A package that depends on another
   codes against the stub and never waits.
3. **The owner of each stub fills it in** in their own worktree. Nobody else edits
   a file they do not own.

The seed commit is the reason light dependencies do not serialise. It is also the
one thing that must be right before anything starts, because every worktree
inherits it.

### File ownership

Each package owns a disjoint set of paths. **A package edits only files it owns.**
Where two packages would touch one file, that file is either split or serialised —
see the collision list below.

| WP | Owns |
| --- | --- |
| WP0 | `core/sessions/turns/service.py` (publish only), `tasks/asyncio/sessions/` |
| WP1 | `core/channels/{dtos,types,service}.py`, `dbs/postgres/channels/`, the migration |
| WP2 | `core/channels/adapters/{interface,registry,normalise}.py`, `tests/.../channels/contract/` |
| WP3 | `apis/fastapi/channels/ingress.py` |
| WP4 | `tasks/asyncio/channels/inbox.py` + `tasks/taskiq/channels/inbox_worker.py` |
| WP5 | `tasks/asyncio/channels/outbox.py` + `tasks/taskiq/channels/outbox_worker.py`, `core/channels/render/` |
| WP6 | `core/channels/adapters/slack/` |
| WP7 | `core/channels/identity.py`, `dbs/postgres/channels/identity_*` |
| WP8 | `apis/fastapi/channels/{router,models}.py` |
| WP9 | `core/channels/commands.py` |
| WP10 | `core/channels/fill.py` |
| WP11 | `tests/.../channels/differential/`, the harness |
| WP12 | `core/channels/adapters/bridge/` |
| WP13 | `web/oss/src/…` (own repo area entirely) |
| WP14 | runner + `core/sessions/` (not channels) |
| WP15 | `core/channels/adapters/mock/` |
| WP16 | `tests/.../channels/slack/fake_slack.py` + its tests (no source files) |
| WP17 | `tests/.../channels/bridge_process/` + its tests (no source files) |
| WP18 | `api/entrypoints/{routers,worker_streams}.py`, `tasks/asyncio/channels/{inbox,outbox}.py` |
| WP19 | `contract.md`, `apis/fastapi/channels/ingress.py` (the bridge arm) |

### Known collisions, and how each is handled

Four files cannot be owned by one package. They are the whole serialisation cost:

| File | Who needs it | Handling |
| --- | --- | --- |
| `api/entrypoints/routers.py` | WP3, WP4, WP5, WP8 | **Serialised at checkpoints only.** Each package prepares its wiring block as a diff and it is applied in checkpoint order. Never edited mid-stream. |
| `api/oss/src/middlewares/auth.py` | WP3 alone | WP3 owns it. The `_PUBLIC_ENDPOINTS` entry is **four lines** — `/x`, `/api/x`, `/preview/x`, `/api/preview/x`, all trailing-slashed, exactly as the Composio and Stripe receivers register. |
| the migration chain | WP1, WP7 | **One migration, owned by WP1**, containing WP7's tables too. The chain is linear (`oss000000021` is next); two packages both claiming a revision id is a guaranteed conflict for no benefit. |
| `core/channels/interfaces.py` | everyone reads, WP1 writes | Frozen by the seed commit. A change to it after that is a checkpoint conversation, not a commit. |

### The two worker halves

`tasks/asyncio/` and `tasks/taskiq/` are not alternatives — the `triggers` domain
uses both, and channels follows it:

- **`tasks/asyncio/channels/`** holds the logic, entity-agnostic and self-contained
  so it can run inside its own worker process. This is where the inbox chain and
  the outbox fold-and-post live, and it is what the tests drive directly.
- **`tasks/taskiq/channels/`** is the queue entry point — the `@broker.task`
  binding that calls into the above. Thin by construction.

Splitting them is what lets WP4 and WP5 be tested without a broker, which is the
difference between a worker you can unit-test and one you can only observe.

### Rebase discipline

Long-lived worktrees drift. Each package rebases on the base branch **at every
checkpoint** and never between — an integration point is where merge pain belongs,
and a package rebasing continuously spends its time on other people's churn.

[`launch.md`](launch.md) turns this into commands: what to run to start wave one,
and the checklist that says C1 has actually been reached.

## The packages

| Spec | Tasks | Package |
| --- | --- | --- |
| [specs-wp0.md](specs-wp0.md) | [tasks-wp0.md](tasks-wp0.md) | Session events |
| [specs-wp1.md](specs-wp1.md) | [tasks-wp1.md](tasks-wp1.md) | Domain and schema |
| [specs-wp2.md](specs-wp2.md) | [tasks-wp2.md](tasks-wp2.md) | Adapter port and registry |
| [specs-wp3.md](specs-wp3.md) | [tasks-wp3.md](tasks-wp3.md) | Ingress route |
| [specs-wp4.md](specs-wp4.md) | [tasks-wp4.md](tasks-wp4.md) | Inbox worker |
| [specs-wp5.md](specs-wp5.md) | [tasks-wp5.md](tasks-wp5.md) | Outbox worker |
| [specs-wp6.md](specs-wp6.md) | [tasks-wp6.md](tasks-wp6.md) | Slack adapter |
| [specs-wp7.md](specs-wp7.md) | [tasks-wp7.md](tasks-wp7.md) | Identity links |
| [specs-wp8.md](specs-wp8.md) | [tasks-wp8.md](tasks-wp8.md) | Configuration API |
| [specs-wp9.md](specs-wp9.md) | [tasks-wp9.md](tasks-wp9.md) | Commands |
| [specs-wp10.md](specs-wp10.md) | [tasks-wp10.md](tasks-wp10.md) | Fill |
| [specs-wp11.md](specs-wp11.md) | [tasks-wp11.md](tasks-wp11.md) | Slack over the bridge |
| [specs-wp12.md](specs-wp12.md) | [tasks-wp12.md](tasks-wp12.md) | Bridge |
| [specs-wp13.md](specs-wp13.md) | [tasks-wp13.md](tasks-wp13.md) | Web app |
| [specs-wp14.md](specs-wp14.md) | [tasks-wp14.md](tasks-wp14.md) | Input sequencing |
| [specs-wp15.md](specs-wp15.md) | [tasks-wp15.md](tasks-wp15.md) | Mock channel |
| [specs-wp16.md](specs-wp16.md) | [tasks-wp16.md](tasks-wp16.md) | Slack over mock |
| [specs-wp17.md](specs-wp17.md) | [tasks-wp17.md](tasks-wp17.md) | A bridge process, at test level |
| [specs-wp18.md](specs-wp18.md) | [tasks-wp18.md](tasks-wp18.md) | Connect what wave 3 built |
| [specs-wp19.md](specs-wp19.md) | [tasks-wp19.md](tasks-wp19.md) | The bridge `source` contract |
| [specs-wp20.md](specs-wp20.md) | [tasks-wp20.md](tasks-wp20.md) | Inbound actions |
| [specs-wp21.md](specs-wp21.md) | [tasks-wp21.md](tasks-wp21.md) | The adapter interface |
| [specs-wp22.md](specs-wp22.md) | [tasks-wp22.md](tasks-wp22.md) | Schema: connections, grants, secrets |
| [specs-wp23.md](specs-wp23.md) | [tasks-wp23.md](tasks-wp23.md) | The connections write path |
| [specs-wp24.md](specs-wp24.md) | [tasks-wp24.md](tasks-wp24.md) | The Agenta channel |
| [specs-wp25.md](specs-wp25.md) | [tasks-wp25.md](tasks-wp25.md) | The Agenta surface |
| — | [tasks-cu.md](tasks-cu.md) | Clean-up before wave 3 (closed) |
| — | [tasks-cu-wave4.md](tasks-cu-wave4.md) | Wave 4's three clean-up phases |
| — | [tasks-cu-wave5.md](tasks-cu-wave5.md) | Wave 5's three clean-up phases |

Wave 5 runs WP20–WP25; its cycle, ownership and collisions are in
[wave5.md](wave5.md).

## Migrations are never verified by pytest

A downgrade drops tables. Against the shared local database that destroys
whatever else is using them, and a "throwaway database" does not exist in this
setup — so a migration round-trip test is either destructive or a lie.

Verify `upgrade`/`downgrade` by hand against local Docker Postgres. No package's
exit condition may include a migration test, and no checklist item should track
one as a gap.
