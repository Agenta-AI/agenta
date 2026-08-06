# Work Lanes — runbook (GitButler) + Work Stream launch prompts

How to create the WL branches in **`vibes/`** and spin up the WS subagents. Nothing
here is executed yet — these are the exact commands and prompts to run at kickoff.

> **Where this runs:** ALL of this work — code, lanes, and docs — lives in **`vibes/`**, which
> is already on `gitbutler/workspace`. The sibling `application/` checkout is a separate repo
> and **must not be used for this work**. Subagents and `but` commands all operate in `vibes/`.

## 1. The lane tree (recap from `../plan.md` §2)

```text
main
└─ WL0  wp0-connections-extract
   └─ WL1  wp1-events-catalog            --anchor wp0
      ├─ WL2  wp2-resolver-promote       --anchor wp1
      │  └─ WL3  wp3-subscriptions       --anchor wp2
      │     ├─ WL4  wp4-ingress-dispatch --anchor wp3
      │     └─ WL6  wp6-web-subscriptions --anchor wp3
      └─ WL5  wp5-web-catalog            --anchor wp1
```

Every functional dep is a tree ancestor → no merge-order coordination (see plan §2).

## 2. Create the lanes (run in `vibes/`, already in workspace mode)

```bash
# take a snapshot first (recovery point)
but oplog snapshot -m "before gateway-triggers lanes"

but branch new wp0-connections-extract
but branch new wp1-events-catalog     --anchor wp0-connections-extract
but branch new wp2-resolver-promote   --anchor wp1-events-catalog
but branch new wp3-subscriptions      --anchor wp2-resolver-promote
but branch new wp4-ingress-dispatch   --anchor wp3-subscriptions
but branch new wp5-web-catalog        --anchor wp1-events-catalog
but branch new wp6-web-subscriptions  --anchor wp3-subscriptions
```

PR bases (each shows only its own diff): `wp1 --base wp0`, `wp2 --base wp1`,
`wp3 --base wp2`, `wp4 --base wp3`, `wp5 --base wp1`, `wp6 --base wp3`. `wp0 --base main`.

## 3. Docs lane (WL-x)

The design docs in `vibes/docs/designs/gateway-triggers/**` go to their own lane in
**`vibes/`** (already in `gitbutler/workspace`):

```bash
# in vibes/
but branch new gateway-triggers-docs
but rub docs/designs/gateway-triggers gateway-triggers-docs   # stage the folder to the lane
but commit gateway-triggers-docs --only -m "<see commit message below>"
but push gateway-triggers-docs
gh pr create --head gateway-triggers-docs --base main --title "<title>" --body "<body>"
```

Title + body authored with the `write-pr-description` skill — draft in [§5](#5-docs-pr-draft).

## 4. WS launch prompts (paste after compact)

**Git/GitButler is ours, not the subagents'.** We (the orchestrator) create the WL branches,
stage files to them, commit, push, and open PRs. A subagent **only writes source + test files
into the working tree** for its WP. It does **not** run `git`, `but`, `gh`, or any
branch/commit/push/PR command. After a subagent reports done, we assign its changes to the
right WL branch and commit them.

**Subagents ask, they don't guess.** If a frozen contract looks wrong, a decision in the spec
is unresolved (e.g. WP0 revoke rule, WP4 sync-vs-async), or the scope is ambiguous, the
subagent **stops and returns the question** to us — it must not change a frozen contract,
pick an open decision, or expand scope on its own. We answer; it resumes.

Freeze the **WS-PRE contracts** first (the interface blocks in each `WP{k}-specs.md`). Then
spawn one subagent per stream. Roots (WS0/WS1/WS2) need no stubs; WS3–WS6 build against the
frozen contracts and stub the named deps.

Each prompt template:

> You are implementing **WP{k}** of the gateway-triggers feature in the `vibes/` repo
> (working dir `/Users/junaway/Agenta/github/vibes`). **Do not touch the sibling
> `application/` checkout — it must not be used for this work.**
> Read your spec at `vibes/docs/designs/gateway-triggers/wp/WP{k}-specs.md` and the parent
> design docs it links (`../plan.md`, `../gap.md`, `../mapping.md`, `../mimics.md`,
> `../research.md`).
>
> **Do NOT touch git or GitButler.** Do not run `git`, `but`, `gh`, or any branch/commit/
> push/PR command. Just create and edit the source and test files for WP{k} in the working
> tree. Branching, committing, and PRs are handled by the orchestrator after you report.
>
> Implement only WP{k}'s scope. For any dependency on another WP, code against the **frozen
> contract** in the specs and stub/mock it in tests (do NOT implement the dependency). Follow
> `vibes/api/AGENTS.md` (layering, DTOs, exceptions) and the migration rule in WP0
> (`core_oss`, not the parked `core` tree). Write acceptance tests in both editions per the
> spec's AC.
>
> **If anything is unresolved — a frozen contract looks wrong, an open decision in the spec
> isn't decided, or scope is ambiguous — STOP and return the question.** Do not change a
> frozen contract, resolve an open decision, or expand scope yourself.
>
> Keep `vibes/docs/designs/gateway-triggers/wp/WP{k}-status.md` updated as you progress (this
> file is fine to edit — it is notes, not git). List the files you changed in your final
> report so the orchestrator can commit them to the right lane.

| Stream | files land for branch | (anchor, set by us) | stubs against frozen contract |
|--------|----------------------|---------------------|-------------------------------|
| WS0 | wp0-connections-extract | main | — |
| WS1 | wp1-events-catalog | wp0 | — |
| WS2 | wp2-resolver-promote | wp1 | — |
| WS3 | wp3-subscriptions | wp2 | ConnectionsGW (WP0), TriggersGW (WP1) |
| WS4 | wp4-ingress-dispatch | wp3 | Subscription DTO/DAO (WP3), resolver (WP2) |
| WS5 | wp5-web-catalog | wp1 | catalog API (WP1), /connections (WP0) |
| WS6 | wp6-web-subscriptions | wp3 | /subscriptions + /deliveries (WP3) |

The "branch" / "anchor" columns are **our** bookkeeping for where we commit the subagent's
output — the subagent itself is branch-agnostic and just writes files. Because subagents don't
touch git, two streams whose files don't overlap can run concurrently in the same tree; we
separate their changes onto the right lanes at commit time (`but rub <path> <branch>` then
`but commit <branch> --only`).

Recommended kickoff: spawn **WS0, WS1, WS2** first (contract-free roots), then WS3–WS6 once
their upstream contracts are confirmed stable.

## 5. Docs PR draft

**Title:** `[docs] Plan gateway triggers: research, proposal, and WP/WL/WS breakdown`

**Body:**

```
## Context
We are adding inbound provider events ("triggers") to the gateway as the dual of the
existing outbound webhooks: Composio triggers invoke Agenta workflows, the way Agenta events
already POST to user endpoints. Before writing code we needed the design fixed and the build
broken into parallelizable units.

## Changes
Adds the gateway-triggers design set under docs/designs/gateway-triggers/:

- research, proposal, gap, mimics, mapping: the status quo, the goal, the delta, the
  parallels to tools/billing/webhooks, and how the webhook payload-mapping mechanism is
  reused for event-to-workflow input mapping.
- plan.md: the work seen through three views over the same seven units. Work Packages are the
  functional DAG (fan-in allowed). Work Lanes are the GitButler merge tree (one parent per
  branch, no fan-in). Work Streams are parallel subagent assignments that build against frozen
  inter-package contracts and stub their upstreams.
- wp/: per-package specs (WP{k}-specs.md) and trackers (WP{k}-status.md), plus this runbook
  with the exact `but` lane commands and the subagent launch prompts.

No application code changes. The connection extract (WP0) documents the one migration
subtlety: it lands in the shared core_oss chain, not the parked core tree.

## Notes
- Lanes are not created yet; this PR is the plan only.
- The migration-chain rule cross-references docs/designs/oss-ee-convergence.
```

(Authored per `write-pr-description`: context-first, concrete, no em dashes, no padding.)
