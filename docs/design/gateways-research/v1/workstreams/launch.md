# Launch runbook

How the packages actually get started in parallel. `README.md` says who owns what; this says what
to run, in what order, and what to check before moving on.

Everything here targets **checkpoint A**. Waves 2 and 3 follow the same shape and are deliberately
not pre-planned in detail, because checkpoint A's outcome changes them.

## Before anything starts

**The seed is not parallel work.** One agent writes it, on the base branch, and everything else
waits. It is small — declarations only — and it is the reason nothing waits afterwards.

- [ ] **Base branch from the current upstream release branch.** Observed at prep time:
      `release/v0.112.0`. Not `main`, not a fork. Re-read the branch name before starting; it
      advances.
- [ ] **Verify the migration head, in the right chain.** WP1's migration belongs to **`core_oss`**,
      whose head was `oss000000020` at prep time, so WP1 writes `oss000000021`.

      Four chains live under `api/oss/databases/postgres/migrations/`. `core` and `tracing` are
      **parked legacy chains**, both at `park00000000`; only `core_oss` and `tracing_oss` are
      live. A head read from `core/` is a parked chain's and is wrong — this document had it
      wrong once. If the head has moved, WP1's spec is stale on one line and nothing else.
- [ ] **Carry the design set onto the base**, so every worktree can read
      `docs/design/gateways-research/v1/` without a second checkout.
- [ ] **Write the seed**: `core/gateways/{dtos,types}.py`, `core/gateways/policy/{dtos,types,interfaces}.py`,
      `core/gateways/llms/{dtos,types,interfaces}.py`, `core/gateways/mcps/{dtos,types,interfaces}.py`.
      Complete declarations, every body `raise NotImplementedError`. **Transcribed from
      `entities.md` §4, §5 and §7 — not re-derived.**

      Run `ruff format` then `ruff check --fix` in `api/` before committing; pre-commit enforces
      both (root `AGENTS.md`).

      **The one thing that must be right** is the credential resolution signature: it takes the
      owner as a parameter even though the only answer today is the project (D10). Nine worktrees
      inherit it.

      A package that finds a declaration wrong **reports it** rather than editing around it.
- [ ] **Add the empty gateways block to `api/entrypoints/routers.py`** — imports and registration
      scaffold only, so that four later packages add lines to a file that already has the domain
      in it.
- [ ] **Verify**: the declarations import, and a test instantiating each DTO with representative
      values passes. Unit level — nothing running.
- [x] **The four seed-blocking rulings are settled** (`open-designs.md`, R1–R4). Each changed a
      signature the seed freezes, so none could be deferred into a worktree:

      - **R1** — `apis/fastapi/gateways/exceptions.py` moves into the **seed**. Three packages
        need `handle_gateway_exceptions()` and they are siblings in the dependency graph, so no
        one of them could own it.
      - **R2** — the resolver port gains `available_provider_keys(*, scope) -> Set[str]`;
        `LlmGatewayService`'s constructor is **unchanged**. Existence of a credential is a
        credential-layer question, and a vault dependency on the service would give it two
        credential seams.
      - **R3** — `GET /v1/models` is backed by `LlmGatewayService.list_models(*, scope,
        namespace, name) -> List[str]`, per endpoint, answering from the allowlist. No new DTO.
      - **R4** — `GatewayPolicyService.record()` ships as a no-op returning `None` that never
        raises. It is WP3's file, not a seed file; what the seed freezes is the call, so wave 2
        changes a body and never a call site.
- [ ] **Commit, and record the SHA.** Every worktree branches from exactly this commit.

If the seed is wrong, every worktree inherits the error. Review it properly even though it does
nothing.

## Fan-out 1 — four packages, launched together

WP5 depends on nothing at all and can start before the seed lands. The other three need only the
seed's declarations.

| Worktree | Branch | Package | Owns |
| --- | --- | --- | --- |
| `gateways-wp1` | `feat/gateways-wp1` | Domain and storage | `dbs/postgres/gateways/`, the migration |
| `gateways-wp2` | `feat/gateways-wp2` | Secret resolution | `core/gateways/policy/resolution.py` |
| `gateways-wp3` | `feat/gateways-wp3` | Policy core | `core/gateways/policy/service.py`, the six `Permission` members |
| `gateways-wp5` | `feat/gateways-wp5` | Test doubles | both `providers/mock/` trees, the compose services |

Each starts by reading `specs-wp{k}.md`, works `tasks-wp{k}.md` top to bottom, stays inside its
owned paths, and **stops at the merge point** rather than reaching into another package's files to
finish something.

**WP5 is not scaffolding.** The mocks are deliverables (D23), and they are what makes checkpoint A
testable without a third-party dependency. A package treating them as throwaway produces a
checkpoint nobody can verify.

## Merge M1 — foundation

Static only, not deployed. Nothing here serves traffic.

- [ ] Merge WP1 first — the other packages' integration tests need its tables.
- [ ] Then WP2, WP3, WP5 in any order; their files are disjoint.
- [ ] Apply the collected `api/entrypoints/routers.py` edits as **one** edit.
- [ ] Migration applies **and downgrades**. By hand, against a real database — never as a pytest.
- [ ] Every fan-out 2 worktree branches from the merged base.

## Fan-out 2 — the two planes, in parallel

| Worktree | Branch | Package | Owns |
| --- | --- | --- | --- |
| `gateways-wp6` | `feat/gateways-wp6` | LLM ingress and relay | `apis/fastapi/gateways/llms/{proxy,utils}.py`, `providers/passthrough/` |
| `gateways-wp7` | `feat/gateways-wp7` | LLM routing and allowlist | `core/gateways/llms/{service,registry,catalog}.py`, `providers/translated/` |
| `gateways-wp8` | `feat/gateways-wp8` | MCP ingress and proxy | `apis/fastapi/gateways/mcps/{proxy,utils}.py`, `providers/http/` |
| `gateways-wp9` | `feat/gateways-wp9` | MCP registry and allowlist | `core/gateways/mcps/{service,registry}.py` |
| `gateways-wp10` | `feat/gateways-wp10` | Endpoint CRUD | `apis/fastapi/gateways/{exceptions.py,llms/router.py,llms/models.py,mcps/router.py,mcps/models.py}` |

**The pairing is deliberate.** On each plane the ingress package and the domain package are
separate, and the plane's `service.py` belongs to the domain package. WP6 calls WP7's service
through the seed's declaration; WP8 calls WP9's. Neither pair blocks the other, and neither edits
the other's files.

## Reaching checkpoint A

Checkpoint A is reached when this runs on the merged base, not when five packages report done.

- [ ] Merge the five, applying the `api/entrypoints/routers.py` lines together as one edit.
- [ ] Both mocks run in the local stack.
- [ ] A request with no token is refused.
- [ ] A request for an endpoint the caller may not use is refused, **before** any upstream call.
- [ ] A permitted model call reaches the mock with the caller's token replaced by the upstream
      secret.
- [ ] A streamed response arrives byte for byte, on **both** planes — tool names, schemas and
      errors included.
- [ ] A model outside a custom endpoint's list is refused.
- [ ] A tool outside a server's allowlist is refused.
- [ ] A hung upstream times out rather than hanging the gateway.
- [ ] A custom MCP server URL pointing at a private, loopback or link-local address — including
      `169.254.169.254` — is refused at registration (WP10) **and** at relay (WP8), and the relay
      connects to the pinned literal IP rather than re-resolving. **Run this check with
      `AGENTA_INSECURE_EGRESS_ALLOWED=false`**: it defaults to `true`, so the guard is inert
      otherwise and the check would pass while proving nothing (D28).
- [ ] Deploy.

**What is deliberately absent:** no audit record, no usage recorded, no per-endpoint
configuration, no OAuth, and **no brokered server** — checkpoint A's reachable targets are our own
servers and the mocks (D23), so the Composio-backed adapter is not a wave 1 deliverable (R8).
Checkpoint A proves the call path and only the call path (`scope-checklist.md`).

## Rules for anyone working a package

1. **Own your paths.** If a task needs a file you do not own, that is a merge-point conversation,
   not a commit.
2. **Rebase at merge points only.** Continuous rebasing spends a package's time on other people's
   churn.
3. **The design documents win.** A spec that disagrees with `entities.md` is a bug in the spec —
   report it rather than implementing around it.
4. **Do not invent names.** Every DTO, column, method and route already exists in `entities.md`.
   A name that is not there is a hallucination, including a plausible one.
5. **Stop at the merge point.** A package running ahead into the next one's work is what makes
   parallel work slower than serial.
6. **Know which tests you may run.** Unit tests need nothing running and can run anywhere.
   Integration and acceptance tests need a deployment; write them, do not run them without one.
