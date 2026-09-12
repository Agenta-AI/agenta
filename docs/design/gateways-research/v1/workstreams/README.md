# Workstreams

One pair of files per work package: `specs-wp{k}.md` (what to build) and `tasks-wp{k}.md`
(the ordered checklist). They exist so a package can be handed to someone — or to an agent in
its own worktree — with no context beyond `v1/`.

`specs-*` states the target. `tasks-*` is a working document: check items off, add what was
missed. Neither carries history; the design documents in `v1/` remain the source of truth,
and a spec that disagrees with them is a bug in the spec.

**Status: wave 1 written.** Waves 2 and 3 follow the same shape and are deliberately not
pre-written, because C1's outcome changes them.

## The base

Everything branches from the **current upstream release branch**, not `main` and not a fork.
That is where this org integrates: feature PRs squash-merge onto the release branch, and the
release branch merges into `main` as a true merge commit. The two diverge, so this is a real
choice rather than a detail.

**Observed at prep time: `release/v0.112.0`.** It advances; re-read the branch name when starting.

**The migration chain is `core_oss`, and its head was `oss000000020`.** So WP1's migration is
`oss000000021` with `down_revision = "oss000000020"`.

There are four chains under `api/oss/databases/postgres/migrations/`, and picking the wrong one is
easy: `core` and `tracing` are **parked legacy chains**, both sitting at `park00000000`, and only
`core_oss` and `tracing_oss` are live. A head read from `core/` is a parked chain's head and is
wrong. Re-verify before writing the migration — `oss000000020` advances too.

## Working in parallel

Every package runs in its **own git worktree**, branched from the same seed commit, and merges
back through review. `plan.md` says what needs what; this section says how to start before a
dependency is finished.

### The seed comes first, and nothing forks before it

The dependencies between these packages are almost entirely **interface** dependencies. So the
interfaces land first, on the base branch, before any worktree starts:

1. **Seed commit** — every DTO, every domain exception, and every port, declared, with each body
   raising not-implemented. Transcribed from `entities.md` §4, §5 and §7, not re-derived.
2. **Every worktree branches from that commit.** A package that depends on another codes against
   the declaration and never waits.
3. **The owner of each declaration fills it in** in their own worktree. Nobody edits a file they
   do not own.

**The one thing that must be right is the secret resolution signature.** It takes the owner as
a parameter even though the only answer today is the project (D10). Every package that resolves a
secret inherits it, and retrofitting it later means touching all of them.

If the seed is wrong, nine worktrees inherit the error. It is worth reviewing properly even though
it does nothing.

## File ownership

**One owner per file.** A package that needs to change another package's file raises it at a
merge point rather than editing.

| Path | Owner |
| --- | --- |
| `core/gateways/{dtos,types}.py` | seed — nobody edits after |
| `core/gateways/policy/{dtos,types,interfaces}.py` | seed |
| `core/gateways/policy/resolution.py` | **WP2** |
| `core/gateways/policy/service.py` | **WP3** |
| `core/gateways/llms/{dtos,types,interfaces}.py` | seed |
| `core/gateways/llms/service.py` | **WP7** (base); **WP28** owns the serialized mock-catalogue follow-on |
| `core/gateways/llms/{registry,catalog}.py` | **WP7** (base); **WP28** owns the serialized mock-catalogue follow-on |
| `core/gateways/llms/providers/translated/` | **WP7** |
| `core/gateways/llms/providers/passthrough/` | **WP6** |
| `core/gateways/llms/providers/mock/` | **WP5** |
| `core/gateways/mcps/{dtos,types,interfaces}.py` | seed |
| `core/gateways/mcps/service.py` | **WP9** (base); **WP28** owns the serialized mock-catalogue follow-on |
| `core/gateways/mcps/registry.py` | **WP9** (base); **WP28** owns the serialized mock-catalogue follow-on |
| `core/gateways/mcps/providers/http/` | **WP8** |
| `core/gateways/mcps/providers/mock/` | **WP5** |
| `core/gateways/llms/{catalog,service,registry}.py` mock-catalogue additions | **WP28** |
| `core/gateways/mcps/{service,registry}.py` mock-catalogue additions | **WP28** |
| `apis/fastapi/gateways/{llms,mcps}/{proxy,utils}.py` mock-route additions | **WP28** |
| `tests/pytest/{unit,integration,acceptance}/gateways/` mock matrix | **WP29** |
| `dbs/postgres/gateways/llms/`, `dbs/postgres/gateways/mcps/` | **WP1** |
| the migration | **WP1** |
| `apis/fastapi/gateways/exceptions.py` | **seed** — three packages need the decorator, so no one package can own it. **Complete, not declared**: it maps exceptions the seed itself defines and depends on no package, so a not-implemented body would leave it unowned |
| `apis/fastapi/gateways/llms/{proxy,utils}.py` | **WP6** (base); **WP28** owns the serialized mock-route follow-on |
| `apis/fastapi/gateways/mcps/{proxy,utils}.py` | **WP8** (base); **WP28** owns the serialized mock-route follow-on |
| `apis/fastapi/gateways/llms/{router,models}.py` | **WP10** |
| `apis/fastapi/gateways/mcps/{router,models}.py` | **WP10** |
| `core/access/permissions/types.py` | **WP3** — the six new members, one edit |
| `api/entrypoints/routers.py` | **shared, serialised at each merge** |

### The two cuts that make this work

**On each plane, transport and domain are different packages.** WP6 and WP8 own the HTTP surface,
streaming, timeouts and the byte-for-byte relay. WP7 and WP9 own the service, the registry, the
catalogue and the allowlists. So the plane's `service.py` belongs to the domain package, not the
ingress one, and the ingress calls it through the declaration the seed froze.

Getting this backwards is the obvious failure: two packages both editing one service file, both
blocked on each other, both rebasing constantly.

**`api/entrypoints/routers.py` is never owned.** Four packages need a line in it. Each writes its
line as a diff in its own `tasks-*`, and the merge applies them together as one edit. A worktree
that edits it directly creates a conflict for the other three.

## Stacked branches

A stack here is linear. A dependency fan-out is expressed through **PR bases**, not graph shape:
put everything in one line in dependency order and set each PR's base to the branch below it, so
each PR shows only its own diff. Lanes touching disjoint files can sit anywhere in the line.

Verify the line by diffing each branch against the one below it — the file list must be exactly
that lane's files — rather than by eyeballing the tree.

## Rules for anyone working a package

1. **Own your paths.** If a task needs a file you do not own, that is a merge-point conversation,
   not a commit.
2. **Rebase at merge points only.** Continuous rebasing spends a package's time on other people's
   churn; a merge point is where that belongs.
3. **The design documents win.** A spec that disagrees with `entities.md` is a bug in the spec.
   Report it rather than implementing around it.
4. **Do not invent names.** Every DTO, column, method and route already exists in `entities.md`.
   A name that is not there is a hallucination — including a plausible one.
5. **Stop at the merge point.** A package that runs ahead into the next one's work is what makes
   parallel work slower than serial.
6. **Tests that need a running dependency are not unit tests.** Unit tests import freely and need
   nothing running. Anything needing the database, Redis or the API is integration or acceptance,
   and is written but not run unless a local deployment exists.
