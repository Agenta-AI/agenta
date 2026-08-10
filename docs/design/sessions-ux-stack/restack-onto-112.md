# Restack the sessions-UX work onto `release/v0.112.0`

## State of the world (verified, 2026-08-10)

| fact | value |
|---|---|
| `main` | has v0.111.0 merged |
| `release/v0.112.0` | PR **#5827** → `main`, OPEN, mergeable, 93 commits |
| our work | **88 commits, all on local `pkg/settings-spine`** |
| our lane branches on `origin` | **none** — `pkg/auth`, `pkg/navigation`, … exist only locally |
| open PRs for our lanes | **none** |
| `release/v0.112.0` has that we don't | 105 commits |
| merge base | `f85c5ac5e1`, an ancestor of both `main` and 112 |

**There is no PR stack to update.** The plan doc's §7 said "commit only, nothing pushed",
and that is still literally true: nothing from this effort has been pushed under any name, and
no PR references it. The three PRs currently targeting `release/v0.112.0` (#5857, #5859, #5860)
are someone else's session fixes.

So the task is to **create** the stack, based on today's `release/v0.112.0` — not to rebase an
existing one.

One thing checked because it would have been nasty: `web/packages/agenta-chat` exists on 112 and
on our branch, but both inherit it from the same ancestor commit `ff8acd5427` (the scaffold). So
there is no duplicate-creation conflict — our chat commits are additive on top of it.

## Base

Stack on **`release/v0.112.0`**, not `main`. 112 is still open, it is where the release is being
assembled, and our work was always meant for it. Bottom lane's PR base = `release/v0.112.0`;
every other lane's base = the lane below it.

## Proposed lanes

Two groups. The first 40 commits are the original carve (the plan doc's Tier 1 + Tier 2, already
committed on lane branches locally). The next 50 are this session's settings work, which has no
lanes yet.

### Already have local branches — rebase these onto 112, in this order

`pkg/auth` → `pkg/navigation` → `pkg/navigation-ui` → `pkg/ui-primitives` →
`pkg/session-surfaces` → `pkg/chat-engine` → `oss/chat-on-shared-engine` →
`mobile/chat-and-shell` → `playground/de-antd` → `pkg/ui-styles` → `pkg/observability` →
`pkg/entities-drive` → `pkg/entity-ui-drive` → `pkg/navigation-shell` → `pkg/sessions-tabs` →
`pkg/home-ui` → `oss/wire-up` → `mobile/agents-templates-settings` →
`pkg/agent-overview-layout` → `pkg/agent-overview-body`

### New lanes for this session's 50 commits

In dependency order — each depends only on lanes below it.

| lane | what | commits |
|---|---|---|
| `pkg/ui-data-table` | `DataTable` in `@agenta/ui` + per-row detail + the responsive header fixes | `82aa890`, `550f58d`, `81e8f13`, `710d401`, `5897dfc` |
| `pkg/shared-edition-gates` | `isEE`/`isToolsEnabled`/`isBillingEnabled` into `@agenta/shared/api`; 15 call sites repointed | `998a53e`, `edf8952` |
| `pkg/entities-organization` | org + workspace API and types into `@agenta/entities/organization` | `76b9531` |
| `pkg/settings-spine` | `@agenta/settings` + `@agenta/settings-ui`; Preferences, Account, API keys, secrets, vault, webhooks, projects | `eb45a4e`, `6fa6d45`, `e9733a8`, `51892a4`, `e5d02b2`, `f87c2c7`, `f84d10f`, `ff5e9f0`, `675003 3`, `7d5b56f`, `88de93a`, `babcb59`, `190f7e6` |
| `oss/drop-reexport-shims` | removes 24 app-layer re-export stubs; repoints ~60 call sites | `102a320` |
| `pkg/settings-org-pages` | Members, Organizations, Access Controls, Domains, SSO | `06e67c0`, `8d5c308`, `714884a`, `e5de1cd`, `bd3cc1a`, `45896f2`, `fd30503`, `a7ff686`, `5ef55f9` |
| `pkg/entity-ui-form-engine` | `SchemaForm` + `SubscriptionForm` off antd `Form` onto `@rc-component/form` | `e2db4ba` |
| `pkg/settings-tools-triggers` | Tools (7 files) and the three Triggers sections | `5b1abd3`, `cffe819`, `9357251`, `1d01adb` |
| `pkg/settings-ee-pages` | Audit Log, Usage & Billing, entitlements | `13ba738`, `6ba7fcf`, `7f78cef`, `03434c1`, `0cb74c3`, `cac44e3` |
| `pkg/entity-ui-drillin-bridge` | `useWorkflowReferenceBridge` out of OSS's drill-in provider into `@agenta/entity-ui` | `984b94e` |
| `mobile/settings` | the `/m` settings screen, its tabs, the write sheets, the nav takeover | `783af5d`, `440b457`, `c245b69`, `4c04fd3`, `a29b5a3`, `118c04c` |
| `mobile/drillin-bridge` | `/m`'s config pane onto the shared bridge — depends on `pkg/entity-ui-drillin-bridge` | `ca5be47` |

`pkg/entity-ui-form-engine` must land **before** `mobile/settings` — the mobile Tools/Triggers
tabs are only writable because that migration removed antd from the drawers.

Every SHA above is abbreviated; validate before use, because at least one was mistyped here
(`6750033` was written as two tokens). Under `set -euo pipefail`:

```bash
set -euo pipefail
for s in <the SHAs for one lane>; do git rev-parse --verify "$s^{commit}" >/dev/null; done
echo "all SHAs resolve"
```

The `pkg/settings-spine` row lists 13 commits; the lane as built holds 12
(`execute-stacked-prs.md`). The branches won that disagreement — one commit was folded into a
neighbouring lane. Another reason to treat this table as a hypothesis.

## Mechanics

Do **not** try to assign files lane-by-lane against the live working tree. The root `AGENTS.md`
documents why that mis-routes (new files land in the topmost lane, `absorb` sends anything it
cannot attribute to the docs lane, multi-hunk files commit partially). Use the **git-stash
isolation** technique from `AGENTS.md` §"Spreading a pile of edits back across an existing stack":
snapshot, stash everything, restore one lane's files at a time into a clean tree, land, verify the
lane's **tip tree** (not its diff), then move on.

Several commits touch both a package and `web/mobile` (for example `fd30503` adds the domains and
SSO sections *and* wires them into `/m`). Those need splitting across two lanes — the sequential
working-tree technique in the same section, not hunk assignment.

## How to run it

Work in this order. Commit nothing to a lane until the lane below it is verified.

1. **Snapshot first.** `but oplog snapshot -m "pre-restack"` if the repo is in GitButler
   workspace mode; otherwise `git branch backup/pre-stack-112 pkg/settings-spine`. This is
   the only safe recovery point and you will want it. **`backup/pre-stack-112` is the one
   canonical name** — `execute-stacked-prs.md` Phase 0 verifies exactly that ref, and an earlier
   draft of this file called it `backup/pre-restack-112`, so a recovery point created under the
   old name satisfies neither runbook's check.
2. **Confirm the base.** `git fetch origin release/v0.112.0`. Everything stacks on that ref,
   not on `main`.
3. **Rebase the 20 existing lanes** onto it, bottom-up, in the listed order. After each:
   `git diff --name-only <lane-below>..<lane>` must list exactly that lane's files and nothing
   from a lower lane. If a lower lane's files appear, the order is wrong — fix it before
   continuing, not after.
4. **Build the 12 new lanes** from the 50 commits, using git-stash isolation (below). Same
   per-lane diff check.
5. **Split the commits that touch two lanes.** `fd30503` is the clearest: it adds the Domains
   and SSO sections to the package *and* wires them into `/m`. Do not try to assign hunks. Use
   sequential working-tree states, and note that the second half is a **new commit on the upper
   lane**, not an amend:

   ```bash
   set -euo pipefail
   git checkout <package-lane>
   # make the tree the package lane's version of the file, then
   git commit -m "<package half>"
   git checkout -b <mobile-lane> <package-lane>       # upper lane branches off the lower one
   # edit the same file to add the /m delta, then
   git commit -m "<mobile half>"
   ```

   **Never `git commit --amend` here.** Amend rewrites *the commit you are standing on* — on the
   package lane that folds the mobile delta into the lower lane (so the upper lane's PR shows an
   empty diff and the lower lane's shows mobile files it should not own), and it rewrites a
   commit every lane above has already built on. `execute-stacked-prs.md` §"Commits that span two
   lanes" says the same thing.
6. **Gates, then push.** Only after every lane's diff is clean.
7. **Open PRs** bottom-up, each based on the lane below.

Do not attempt this with `but rub` / `but absorb` against the live working tree. The root
`AGENTS.md` documents exactly how that mis-routes: new files land in the topmost lane,
`absorb` sends anything it cannot attribute to the docs lane, and a multi-hunk file commits
partially with a warning that is easy to miss. Use the stash-isolation technique instead —
stash everything, restore one lane's files into a clean tree, land, verify the lane's **tip
tree** (`git show <lane>:<file>`), then the next.

## Before pushing

- `pnpm lint-fix` from `web/` — 24/24.
- `tsc --noEmit` = 0 for **all eight** packages the stack touches: `@agenta/shared`, `@agenta/ui`,
  `@agenta/entities`, `@agenta/entity-ui`, `@agenta/settings-ui`, `@agenta/oss`, `@agenta/ee`,
  `@agenta/mobile`. (An earlier version of this list omitted `@agenta/shared` and
  `@agenta/entity-ui`, so the gate could pass with two packages never compiled. Use the loop in
  `execute-stacked-prs.md` Phase 3 — it runs `tsc` directly under `set -euo pipefail` rather than
  counting `error TS` lines, so a failed `pnpm` cannot read as zero errors.)
- Per lane, `git diff --name-only <lane-below>..<lane>` must list exactly that lane's files.
- PR bases: bottom = `release/v0.112.0`, each other = the lane below.

## Two things that are not ready to push

1. **Nothing here has been run in a browser.** The `@rc-component/form` migration touches the
   elicitation form the chat runtime drives; the `/m` write sheets call real mutation endpoints.
   Static gates only.
2. **`@agenta/mobile` currently fails `tsc`** with 17 errors that belong to another agent's
   in-flight work (`jotai-family` resolution, `useMobileNavItems`, `PreferencesTab`,
   `useVoiceComposer`). That has to settle before `mobile/settings` can be verified.

Commit messages: no "Claude"/"Anthropic"/"Co-Authored-By" lines.

## Note on these docs

They live untracked in `docs/design/sessions-ux-stack/`, which means a `git stash -u` sweeps
them up and a restore that misses `stash^3` loses them. That already happened once — they were
recovered from `stash@{0}^3`. Commit them, or keep them outside the worktree.
