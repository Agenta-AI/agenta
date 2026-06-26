# Gateway Triggers — Plan

Work breakdown for the gap (`gap.md`). The work splits into seven units; we look at them
through **three different lenses**, each with its own dependency semantics. Same seven units
in every view — only the edges differ.

| View | Unit | Edge means | Fan-in? | Answers |
|------|------|-----------|---------|---------|
| **Work Packages** (WP) | a unit of functionality | *X functionally needs Y* (code/data dependency) | **yes** — the true DAG | what depends on what |
| **Work Lanes** (WL) | a GitButler branch | *X is `--anchor`ed on Y* (merge/review tree) | **no** — one parent per branch | how it merges |
| **Work Streams** (WS) | a parallel build assignment | *X builds against Y's frozen contract* (stub until merged) | n/a — all run at once | who builds what concurrently |

Each WP closes a set of `gap.md` items and is independently **reviewable** (a coherent diff)
and **functional** (does something real and testable on its own) — see §3 for per-package
detail. The same unit carries one id in each view: a package is `WP{k}`, its lane node
`WL{k}`, its stream slot `WS{k}` (same `k`).

**The seven units** (full scope in §3):

| k | Unit | Area |
|---|------|------|
| 0 | Connection extract (A2-2): shared `gateway_connections` + service | api (touches shipped tools) |
| 1 | Events catalog + `ComposioTriggersAdapter` | api |
| 2 | Resolver promotion to SDK (`resolve_target_fields`) | sdk + webhooks |
| 3 | Subscriptions + deliveries tables + CRUD | api |
| 4 | Ingress + dispatch (receive → resolve → invoke → record) | api |
| 5 | Web: catalog + connections UI | web |
| 6 | Web: subscriptions + deliveries UI | web |

---

## 1. Work Packages — functional dependencies (the true DAG, fan-in allowed)

What each unit needs to *work*, from the data model and call graph. This is the ground truth;
the other two views are derived from it. Fan-in is real here — a node can need two others.

```text
WP0 ─────────────┬──────────────▶ WP3 ──────────┬──────────▶ WP4
(gateway_conns)  │   (FK + adapter) ▲            │ (tables)
                 │                  │            │   ▲
WP1 ──┬──────────┘                  │            │   │
(catalog+adapter) │  (adapter)──────┘            │   │
      │           └────────────────────────▶ WP5 │   │
      │                          (catalog+conns)  │   │
WP2 ──────────────────────────────────────────────┘   │ (resolver)
(resolver→SDK)                                          │
                                                   WP6 ─┘
                                          (subs/deliveries API ← WP3)
```

Edges (X ← Y reads "X functionally needs Y"):

- **WP3 ← WP0** — `subscriptions` FKs `gateway_connections` (gap S1).
- **WP3 ← WP1** — creating the `ti_*` calls `ComposioTriggersAdapter.create_subscription`
  (the *adapter*, not the catalog routes). → WP3 fans in on {WP0, WP1}.
- **WP4 ← WP3** — dispatch reads a subscription, writes a delivery row.
- **WP4 ← WP2** — dispatch imports the promoted `resolve_target_fields`. → WP4 fans in on
  {WP3, WP2}.
- **WP5 ← WP1** (catalog API) **and ← WP0** (the `/…/connections` view over
  `gateway_connections`). → WP5 fans in on {WP1, WP0}.
- **WP6 ← WP3** — the `/triggers/subscriptions` + `/triggers/deliveries` API.
- **WP0, WP1, WP2** — no in-feature dependency (roots).

---

## 2. Work Lanes — merge tree (GitButler `--anchor`, no fan-in)

A GitButler series is linear: each branch has exactly **one** `--anchor` parent (two parents
is a merge commit, which collapses the stack — `vibes/AGENTS.md`: "series need linear
history"). So the WP DAG must be **projected onto a tree**: every WP fan-in is resolved by
anchoring on *one* functional parent; the other functional parent(s) must simply be a
**transitive ancestor** in the tree (so the needed code is present in the branch). Fan-**out**
is allowed (a parent may have many children).

The constraint that shapes the tree: **WP4 needs WP2's resolver**, so WP2 must sit on the
line *below* WP4 (an ancestor), not on a sibling branch — otherwise that edge would be a
fan-in the tree can't hold. Placing WP2 between WP1 and WP3 satisfies it:

```text
main
└─ WL0  wp0-connections-extract
   └─ WL1  wp1-events-catalog            --anchor wp0
      ├─ WL2  wp2-resolver-promote       --anchor wp1     (on the WL4 line, so WP2 is WL4's ancestor)
      │  └─ WL3  wp3-subscriptions       --anchor wp2     (ancestors wp2,wp1,wp0 ✓ cover WP0+WP1)
      │     ├─ WL4  wp4-ingress-dispatch --anchor wp3     (ancestors incl. wp2 ✓ + wp3 ✓)
      │     └─ WL6  wp6-web-subscriptions --anchor wp3
      └─ WL5  wp5-web-catalog            --anchor wp1     (ancestors wp1,wp0 ✓)
```

**Every functional edge from §1 is covered by a tree ancestor**, with no branch having two
parents:

| WP needs | satisfied in tree by |
|----------|----------------------|
| WP3 ← WP0, WP1 | WL3 anchored on WL2; WL0, WL1 are ancestors |
| WP4 ← WP3, WP2 | WL4 anchored on WL3; WL2 is an ancestor |
| WP5 ← WP1, WP0 | WL5 anchored on WL1; WL0 is an ancestor |
| WP6 ← WP3 | WL6 anchored on WL3 |

Each PR sets `--base` to its anchor so the diff stays scoped. Merge is bottom-up along the
tree; because every dependency is a structural ancestor, **no cross-branch merge-order
coordination is required** — the property we couldn't get from parallel lanes.

> Trade-off of the tree: it linearizes WP2 and WP5/WP6 under the WP1 line. That is a *merge*
> topology only — it does **not** mean they must be *built* in that order. See Work Streams.

---

## 3. Work Streams — parallel subagent assignments (build against contracts, not merged code)

A WS is a **self-contained build assignment** that one subagent can take end-to-end *right
now*, **in parallel with every other stream**, even though the feature's e2e behavior can't
be exercised until upstream WPs land. The lane tree (§2) is a merge topology; the WP DAG (§1)
is a runtime dependency graph. Neither is a build schedule — **all seven streams can be in
flight simultaneously** if each builds against an agreed *contract* rather than against the
other's merged code.

**What makes that possible — freeze the inter-package contracts first (WS-PRE):**

- `ConnectionsGatewayInterface` (WP0 ↔ WP3/WP5) — the shared-connection service signatures.
- `TriggersGatewayInterface` incl. `create_subscription` (WP1 ↔ WP3) — the adapter surface.
- `resolve_target_fields(template, context)` (WP2 ↔ WP4) — the resolver signature + the
  `{event, subscription, scope}` context shape.
- The subscription/delivery **DTOs** and the `/triggers/*` **route+payload shapes**
  (WP3 ↔ WP4/WP6, WP1 ↔ WP5).

These are small, decidable up front (they're already specified across `mapping.md`,
`mimics.md`, and §4 here). Once frozen, a downstream stream codes against the interface and
**mocks/stubs the dependency in its own unit tests**; the real wiring + e2e test happens when
the dependency merges into its WL ancestor.

```text
contracts frozen (WS-PRE)
   ├─ WS0  WP0 connection extract        ┐
   ├─ WS1  WP1 catalog + adapter         │ all seven run concurrently;
   ├─ WS2  WP2 resolver → SDK            │ each subagent builds its WP to a
   ├─ WS3  WP3 subscriptions             │ complete, unit-tested PR against the
   ├─ WS4  WP4 ingress + dispatch        │ frozen contracts + stubs for upstream
   ├─ WS5  WP5 web catalog/connections   │
   └─ WS6  WP6 web subscriptions/deliv.  ┘
                                          → e2e tests light up as WLs merge bottom-up
```

What each stream stubs until its dep is real (everything else it owns outright):

| Stream | Builds | Stubs (frozen contract) until dep merges |
|--------|--------|-------------------------------------------|
| WS0 | shared connections service + migration | — (root) |
| WS1 | catalog + `ComposioTriggersAdapter` | — (root; live Composio creds for the real test) |
| WS2 | resolver move + webhooks repoint | — (root; webhooks suite is the proof) |
| WS3 | subscription/delivery tables + CRUD | `ConnectionsGatewayInterface` (WP0), `TriggersGatewayInterface` (WP1) |
| WS4 | ingress + dispatch | subscription DTO/DAO (WP3), `resolve_target_fields` (WP2) |
| WS5 | catalog/connections UI | catalog API (WP1), `/…/connections` (WP0) — mocked HTTP |
| WS6 | subscription/deliveries UI | `/triggers/subscriptions` + `/deliveries` API (WP3) — mocked HTTP |

So the streams are assigned to subagents by **area** and run fully in parallel — api (0,1,3,4),
sdk+webhooks (2), web (5,6) — with the contract freeze (WS-PRE) as the one thing that must
happen before fan-out. The only sequential constraint left is *when e2e (not unit) tests can
pass*, and that follows the WL merge order automatically.

---

## 4. Work packages (detail)

Each WP lists scope, the gap items it closes, dependencies, and the acceptance bar. "AC"
follows the house rule: ungated endpoints get acceptance tests in **both** editions (OSS
basic account, EE inline business+developer account) — see `feedback_oss_ee_test_accounts`.

### WP0 — Connection extract (A2-2) · WL0 root (anchor `main`) · WS0

Move the provider connection out of `/tools` into the shared, routerless `connections`
domain, leaving the `/tools/connections` contract byte-for-byte unchanged.

- **Closes:** C1, C2, C3, C4, C5, C6 (and lands the C7 *rule* in code).
- **Scope:**
  - Rename `tool_connections` → `gateway_connections` (+ `uq_`/`ix_`); rename-only (no data
    transform). Author the revision **once in the shared `core_oss` chain** (rooted
    `oss000000000`, version table `alembic_version_oss`), which runs in **both** editions —
    EE ships the `oss/` tree and runs it from there (no copy in `core_ee`). **Not** the
    parked legacy `core` tree (frozen at `park00000000`, where `tool_connections` was
    originally added) and **not** `core_ee` (that chain is EE-only divergence;
    `gateway_connections` is shared schema). See
    `docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md`.
  - Create `core/gateway/connections/` (service + DAO + `ConnectionsGatewayInterface`) and
    `dbs/postgres/gateway/connections/` (DBE + DAO + mappings). **No router.**
  - Move the Composio auth verbs (initiate/status/refresh/revoke) out of
    `ComposioToolsAdapter` into the shared connection adapter.
  - Repoint `ToolsService` connection management at the shared service; the
    `/tools/connections` and `/callback` handlers now delegate. Fix the ~4 `tool_connections` string refs
    (`dao.py:72` error match, `router.py:160` operation_id).
  - Implement the **cross-domain revoke rule** (C7): revoke affects all consumers; expose a
    "used by" usage read. (No trigger consumer exists yet — this is the rule + the seam.)
- **Functional deps (WP):** none (a root).
- **Lane (WL):** `WL0`, anchored on `main` — the tree root.
- **Stream (WS):** `WS0` — api area; a root, no stubs; runs in parallel with all streams.
- **Decision to lock first:** cross-domain revoke rule (gap C7).
- **AC:** every existing `/tools/connections` test passes **unchanged** (the contract-frozen
  invariant); migration up/down clean on both editions; connect/refresh/revoke still work
  end-to-end via `/tools/connections`.
- **Risk:** this is the one PR that edits shipped tools code. Keep it a pure refactor +
  rename — no behavior change visible at `/tools`. Largest blast radius; review first.

### WP1 — Triggers skeleton + events catalog + adapter · WL1 (anchor WL0) · WS1

Stand up the triggers domain, the read-only events catalog, and the triggers adapter.

- **Closes:** E1, E2, E3, E4 (and resolves E5).
- **Scope:**
  - Domain skeleton `apis/fastapi/triggers/`, `core/triggers/`, `dbs/postgres/triggers/`
    (mirror tools layout).
  - `ComposioTriggersAdapter` (own httpx client; `triggers_types`,
    `trigger_instances/...`) behind `TriggersGatewayInterface`.
  - Events catalog: `/triggers/catalog/.../integrations/{i}/events/{event_key}` returning
    the event `trigger_config` schema.
  - Wiring block in `entrypoints/routers.py` next to tools; built only when
    `env.composio.enabled`.
  - **Verify exact v3 REST paths against the live OpenAPI spec (E5).**
- **Functional alone:** yes — browse the catalog, fetch a config schema. Read-only, no
  connection, no subscription.
- **Functional deps (WP):** none in-feature (uses `env.composio`, not the connection). A
  root in the §1 DAG.
- **Lane (WL):** `WL1`, anchored on `WL0` (no functional need for WP0 — anchored here only
  to keep the tree linear and make WL1 an ancestor of WL3/WL5).
- **Stream (WS):** `WS1` — api area; a root, no stubs (live Composio creds for the real
  test); runs in parallel.
- **AC (both editions):** browse providers/integrations/events; fetch one event's config
  schema; catalog empty/disabled when `env.composio` unset.

### WP2 — Resolver promotion (SDK + webhooks) · WL2 (anchor WL1) · WS2

Promote the mapping resolver to the SDK under a neutral name so triggers and webhooks both
consume it without a cross-domain import. A complete, testable change on its own — its
**live consumer today** is webhooks, independent of triggers entirely.

- **Closes:** M1.
- **Scope:** move `resolve_payload_fields` (`core/webhooks/delivery.py:95`) to
  `agenta.sdk.utils.resolvers` as **`resolve_target_fields`** (next to `resolve_json_selector`);
  update the webhooks call site to the new name. Pure move + rename, no behavior change.
- **Functional alone:** yes — webhooks delivery resolves payloads through the relocated
  resolver; its suite is the proof.
- **Functional deps (WP):** none in-feature. A root in the §1 DAG.
- **Lane (WL):** `WL2`, anchored on `WL1` — *not* a functional need; placed on the line to
  WL4 so the resolver is a structural ancestor of WP4 (the one consumer that needs it),
  removing the cross-branch merge-order edge.
- **Stream (WS):** `WS2` — sdk+webhooks area; a root, no stubs (webhooks suite is the proof);
  runs in parallel.
- **AC:** existing webhook delivery tests pass unchanged against the renamed/relocated
  resolver.

### WP3 — Subscriptions + deliveries · WL3 (anchor WL2) · WS3

The two-table heart of the domain. **Hard-depends on `gateway_connections` existing** (the
subscription FK). Functional as **subscription CRUD** before any dispatch exists.

- **Closes:** S1, S2, S3, S4, S5.
- **Scope:**
  - `subscriptions` table (FlagsDBA, DataDBA): `ti_*`, `trigger_config`, `inputs_fields`,
    destination `references`/`selector`, workflow ref, **FK → `gateway_connections`**.
  - `deliveries` table: resolved `inputs`, workflow `references`, `result`/`error`, plus the
    `metadata.id` dedup column (I4).
  - DBA mixins for both (mirror `dbs/postgres/webhooks/dbas.py`).
  - Migration authored once in the shared `core_oss` chain (both editions, per WP0's note).
  - Subscription CRUD `/triggers/subscriptions/` · `/query` · `/{id}` · `/{id}/refresh` ·
    `/{id}/revoke`, creating/disabling/deleting the Composio `ti_*` through the adapter and
    referencing a shared connection (deleting a subscription must **not** revoke the
    connection — C7).
  - Delivery read routes `/triggers/deliveries` · `/{id}` · `/query`.
- **Functional alone:** yes — create/list/disable/delete a subscription (and its Composio
  `ti_*`), read the deliveries table. The standing-watch lifecycle works end-to-end even
  though nothing is dispatching into it yet.
- **Functional deps (WP):** **WP0** (FK → `gateway_connections`) **and** **WP1's adapter**
  (`create_subscription` builds the `ti_*` — the adapter, not the catalog routes). A fan-in
  in the §1 DAG.
- **Lane (WL):** `WL3`, anchored on `WL2`; both functional parents are tree ancestors (WL0
  and WL1 sit above WL2), so neither needs merge-order coordination and there is no stub.
- **Stream (WS):** `WS3` — api area; runs in parallel, stubbing `ConnectionsGatewayInterface`
  (WP0) and `TriggersGatewayInterface` (WP1) against their frozen contracts until those merge.
- **Decision to lock first:** idempotency store (I4 — column on `deliveries`); default
  mapping + validation posture (M8).
- **AC (both editions):** create a subscription on a shared connection bound to a workflow;
  list/disable/delete; deleting it leaves the connection intact; deliveries list returns
  rows.

### WP4 — Ingress + dispatch · WL4 (anchor WL3) · WS4

Close the loop in **one** functional unit: an inbound event is received, verified, scoped,
resolved, and acted on. Ingress lives here (not as its own lane) because a verify-and-park
endpoint isn't functional on its own — the receive path only becomes real once it dispatches.

- **Closes:** I1, I2, I3, I4, I5, I6, M2, M3, M4, M5, M6, M7, M9; consumes M1.
- **Scope (ingress half):**
  - `POST /triggers/composio/events/` reading raw body before parse (mimic billing).
  - HMAC-SHA256 verify over `{id}.{ts}.{body}` with `COMPOSIO_WEBHOOK_SECRET`; 401 bad sig;
    200 no-op when secret unset; add `COMPOSIO_WEBHOOK_SECRET` to `env`.
  - Recover `project_id` from `metadata.user_id`; route `metadata.trigger_id` → local
    subscription; 200-skip unknown/disabled; optional `target`-style env guard (I5).
  - One-time project webhook-URL registration with Composio (I6).
- **Scope (dispatch half):**
  - Resolve `inputs_fields` via `resolve_target_fields` against `{event, subscription, scope}`
    with `TRIGGER_EVENT_FIELDS` (M2, M3) into `data.inputs` only.
  - Build the `WorkflowServiceRequest`: destination from the stored workflow `references`/
    `selector` (M4); call `WorkflowsService.invoke_workflow` (M5).
  - **System-initiated identity** (M6) — run as a resolved project-system `user_id`.
  - **Async dispatch** (M7) — ack-fast + enqueue; ingress returns 2xx promptly.
  - Real `metadata.id` dedup against `deliveries` (I4); write a delivery row per event with
    outcome; dispatch retry policy (M9).
- **Functional alone:** yes — this is the first PR where a signed inbound event invokes a
  workflow and lands a delivery row. The whole feature becomes usable here.
- **Functional deps (WP):** **WP3** (subscriptions + deliveries to read/write) **and** **WP2**
  (imports `resolve_target_fields`). A fan-in in the §1 DAG.
- **Lane (WL):** `WL4`, anchored on `WL3`; WP2 (`WL2`) is a tree ancestor of WL3, so the
  resolver import is structural — no merge-order edge, no old-location import.
- **Stream (WS):** `WS4` — api area; runs in parallel, stubbing the subscription DTO/DAO (WP3)
  and `resolve_target_fields` (WP2) against their frozen contracts until those merge.
- **Decisions to lock first:** webhook-URL registration (I6), sync-vs-async (M7), system
  `user_id` (M6), retry policy (M9).
- **AC (both editions):** forged signature → 401; unset secret → 200 no-op; signed event
  for a known subscription → bound workflow invoked with the mapped inputs; duplicate
  `metadata.id` → single invocation; bad mapping / missing workflow → a `deliveries` error
  row (no workflow trace), still 2xx to the provider.

### WP5 — Web: catalog + connections UI · WL5 (anchor WL1) · WS5

The browse half of the FE: providers/integrations/events and the connection list.

- **Closes:** F1 (catalog/connect part), F2.
- **Scope:** "Triggers" entry on a connected integration — browse events and their config
  schema (WP1 catalog API); show connections via `/triggers/connections`; handle the
  **overlapping connection reads** across `/tools/connections` and `/triggers/connections`
  (same rows, F2).
- **Functional alone:** yes — browse events and see connections against a merged WP1, even
  before subscriptions exist.
- **Functional deps (WP):** **WP1** (catalog API) **and** **WP0** (the `/…/connections` view
  over `gateway_connections`). A fan-in in the §1 DAG.
- **Lane (WL):** `WL5`, anchored on `WL1`; WP0 (`WL0`) is a tree ancestor, so both deps are
  covered. (Sibling of WL2 under WL1 — fan-out off WL1 is fine.)
- **Stream (WS):** `WS5` — web area; runs in parallel, mocking the catalog (WP1) and
  `/…/connections` (WP0) HTTP against their frozen shapes until those merge.
- **AC:** browse a connected integration's events; the same connection appears under both
  tools and triggers without a second connect.

### WP6 — Web: subscriptions + deliveries UI · WL6 (anchor WL3) · WS6

The management half of the FE: create/manage subscriptions and view deliveries.

- **Closes:** F1 (subscribe part), F3.
- **Scope:** create a subscription (pick event + bind workflow + mapping), list / disable /
  delete (WP3 subscription API); deliveries audit view (`/triggers/deliveries`, F3 —
  deferrable past v1).
- **Functional alone:** yes — create and manage subscriptions against a merged WP3; a new
  subscription simply shows no deliveries until WP4 dispatch lands.
- **Functional deps (WP):** **WP3** only (the `/triggers/subscriptions` + `/triggers/deliveries`
  API). Independent of WP4 — the management UI doesn't need dispatch to exist.
- **Lane (WL):** `WL6`, anchored on `WL3` (sibling of WL4 — WL3 fans out to both).
- **Stream (WS):** `WS6` — web area; runs in parallel, mocking the WP3 HTTP surface
  (`/triggers/subscriptions` and `/triggers/deliveries`) against its frozen shape until WP3
  merges.
- **AC:** create a workflow-bound subscription; list/disable/delete it; deliveries view
  renders (empty until WP4).

---

## 5. The three views, side by side

Same seven units, the three edge sets together. Read across a row to see how one unit looks
in each lens.

| k | Unit | Closes | WP — functional deps | WL — anchor | WS — area · stubs until dep merges |
|---|------|--------|----------------------|-------------|-------------------------------------|
| 0 | connection extract | C1–C7 | — | `main` | api · — |
| 1 | catalog + adapter | E1–E5 | — | WL0 | api · — |
| 2 | resolver → SDK | M1 | — | WL1 | sdk+webhooks · — |
| 3 | subscriptions + deliveries | S1–S5 | WP0, WP1 | WL2 | api · stubs ConnectionsGW (WP0), TriggersGW (WP1) |
| 4 | ingress + dispatch | I1–I6, M2–M9 | WP3, WP2 | WL3 | api · stubs subs DTO (WP3), resolver (WP2) |
| 5 | web catalog/connections | F1, F2 | WP1, WP0 | WL1 | web · mocks catalog (WP1), /connections (WP0) |
| 6 | web subscriptions/deliveries | F1, F3 | WP3 | WL3 | web · mocks /subscriptions+/deliveries (WP3) |

The WL anchors form the tree of §2; every WP fan-in (rows 3, 4, 5) is covered because the
non-anchor parent is a tree ancestor. The WS column is the parallel-subagent view of §3 — all
seven build concurrently against frozen contracts (WS-PRE), stubbing the listed dep until it
merges; e2e tests light up in WL merge order.

---

## 6. Risks & sequencing notes

- **WP0 is the only PR that touches shipped tools code.** Keep it a pure refactor+rename
  with the `/tools/connections` contract frozen; it is the tree root, so it is reviewed and
  merged first regardless. A regression here hits live tools.
- **GitButler stacking caveat (from `vibes/AGENTS.md`):** keep the WL tree a true GitButler
  stack (`--anchor`); do **not** sync branches by merging them into each other — a
  merge-based series can collapse to a single addressable tip on unapply/re-apply. Snapshot
  (`but oplog snapshot`) before risky stack surgery.
- **Stacked PR bases follow the WL anchors:** each PR sets `--base` to its anchor branch
  (e.g. `wp3` `--base wp2`, `wp4` `--base wp3`, `wp5` `--base wp1`, `wp6` `--base wp3`) so
  each shows only its own diff.
- **No merge-order coordination needed.** Because every functional dep is a WL ancestor (§2),
  there is no "merge X before Y" rule to remember — the tree enforces it. (This is why the
  tree linearizes WP2 and WP5 under WL1 rather than running them as free parallel lanes.)
- **Decisions that gate code** (from `gap.md` §3) close at the head of the WP that needs them
  — revoke rule before WP0; REST paths (E5) before WP1's adapter; idempotency + mapping
  default before WP3; async + identity + retry + URL-registration before WP4.
- **Build order ≠ lane order.** The WL tree is a merge topology; the WS view (§3) is parallel
  build assignments against frozen contracts. A branch deep in the tree (e.g. WP4) can be in
  active development while an ancestor (e.g. WP1) is still in review — GitButler lets you push
  fixes mid-stack, and the contract freeze lets the subagent build before WP1 merges.
- **Contract freeze (WS-PRE) is the one true prerequisite.** Parallelism depends on the
  inter-package interfaces (§3) being fixed before fan-out; a contract change after fan-out
  forces a re-sync across the dependent streams. Lock them with the gate decisions above.
