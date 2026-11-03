# Handoff 2 — land the QueryClient host-contract work

> **HISTORICAL — fully executed, landed as PR #5915.** Every branch, worktree and dirty-status
> reference below was true when this was written and is not an instruction to follow now. Read
> [`plan.md`](./plan.md) for the current state; keep this only for the reasoning behind the choices.

Continues [`handoff.md`](./handoff.md); background in [`plan.md`](./plan.md). WP1 and WP2 are
**done and independently verified** — do not redo them.

## What is already true (verified, not just reported)

- No file under `web/packages/**` imports the `queryClient` singleton. 17 call sites converted
  (the plan's 16 plus a dynamic `await import()` in `playgroundController.ts:1703`).
- `getHostQueryClient()` exists in `packages/agenta-shared/src/api/hostQueryClient.ts`, exported
  from `api/index.ts`, resolved per call — no module-scope capture anywhere.
- Lint ban is live and **fires** (probed with a deliberate violation). `restrictedImportPaths` is
  exported from `packages/eslint.config.mjs` and spread by all 11 packages that override
  `no-restricted-imports`; none of them silently drops it.
- Dev assertion in `queryClient.ts`: deferred, re-checked once at 1s, once-only, off in
  prod and SSR. 5 unit tests.
- Contract documented in `web/AGENTS.md` § "The QueryClient host contract" and in the
  `agenta-package-practices` skill.
- Gates: `pnpm lint-fix` 24/24 with the tree unchanged; `tsc --noEmit` 0 across `@agenta/shared`,
  `ui`, `entities`, `entity-ui`, `settings-ui`, `playground`, `annotation`, `oss`, `ee`, `mobile`.

Everything is **uncommitted**, in worktree `.claude/worktrees/sessions-ux`, currently sitting on
branch `chore/mobile-next16`.

## Decisions taken — do not relitigate

1. **This work stacks ON TOP of the sessions-UX stack**, based on `docs/sessions-ux-stack`.
   It cannot branch off `release/v0.112.0`: eight touched packages (`agenta-settings-ui`,
   `agenta-settings`, `agenta-home-ui`, `agenta-navigation`, `agenta-navigation-ui`,
   `agenta-observability`, `agenta-auth`, `agenta-auth-ui`) are created by the stack and do not
   exist on 112.
2. **Base it on `docs/sessions-ux-stack`, not on `chore/mobile-next16`.** The Next 16 migration is
   an unrelated review; basing on it would drag 458 lines of lockfile plus a `middleware→proxy`
   rename into this PR's diff.
3. **The mobile `queryClient.ts` fix ships in this same lane**, not folded into a mid-stack lane.
   Rewriting lane #5885/#5893 would mean force-pushing every lane above it for no correctness
   benefit while all 30 PRs are drafts.

## Task 1 — close the dynamic-import hole in the lint rule

`no-restricted-imports` does **not** flag `await import(...)`. Verified:

```
static   import {queryClient} from "@agenta/shared/api"          → error ✓
dynamic  const {queryClient} = await import("@agenta/shared/api") → passes ✗
```

That is precisely the shape of the 17th call site, so the one hole in the inventory is also the one
hole in the guard. Add a `no-restricted-syntax` rule in `packages/eslint.config.mjs` matching an
`ImportExpression` whose source is `@agenta/shared/api` **when** the result destructures
`queryClient` — or, if that selector proves brittle, flag any dynamic import of
`@agenta/shared/api` and have the one legitimate site use `getHostQueryClient` (it already does).

Prove it both ways before and after, the same way it was probed:

```bash
cd web/packages/agenta-entities
cat > src/__lintprobe.ts <<'EOF'
export const a = async () => {
    const {queryClient} = await import("@agenta/shared/api")
    return queryClient
}
EOF
npx eslint --config ../eslint.config.mjs src/__lintprobe.ts   # must ERROR after your change
rm src/__lintprobe.ts
```

Delete the probe file. Do not commit it.

## Task 2 — move onto the right base and commit

```bash
cd .claude/worktrees/sessions-ux
git status --porcelain | grep -v 'web/.claude'      # 37 entries; know what they are before moving
git checkout -b fix/package-query-client docs/sessions-ux-stack
git status --porcelain | grep -v 'web/.claude'      # SAME 37 entries must survive the switch
```

The next16 commit and this change set are disjoint (checked), so the switch carries cleanly.
**But it reverts the lockfile**, so afterwards:

```bash
cd web && pnpm install                               # node_modules must match the new base
```

Do **not** `git stash -u` to move things around. `docs/design/query-client-host-divergence/` is
untracked, and a stash that sweeps it up has already nearly lost design docs once in this effort
(root `AGENTS.md` records the incident).

Suggested commit split — three commits, each independently reviewable:

1. `fix(frontend): package cache writes address the host's QueryClient`
   — `hostQueryClient.ts`, `api/index.ts`, the 17 converted call sites, and
   `web/mobile/src/lib/queryClient.ts`.
2. `chore(frontend): lint-ban the QueryClient singleton in package code`
   — `packages/eslint.config.mjs` + the 11 override configs, the dev assertion and its tests.
3. `docs(frontend): the QueryClient host contract`
   — `web/AGENTS.md`, the `agenta-package-practices` skill, and
   `docs/design/query-client-host-divergence/`.

After committing, verify the lane contains exactly this work and nothing from below:

```bash
git diff --name-only docs/sessions-ux-stack..fix/package-query-client
```

## Task 3 — live verification (blocking; do not skip)

**A green `tsc` proves nothing here** — the original bug type-checked perfectly and shipped a
success toast. Arda runs the dev servers; ask him for a URL rather than starting one.

On `/m`, Settings → Triggers: create a subscription, delete a subscription, create a schedule.
Each must settle **without a reload and without pressing the section refresh button**.

If anything still goes stale, use the probe recipe in `plan.md` §"How to verify a host is wired
correctly" before forming a theory — tag the singleton, compare the three client ids, dump
`getQueryCache().getAll()`.

## Task 4 — WP3 sweep on `/m`

Every converted path was dead on mobile until the fix, so anything already shipped on `/m` that
depends on them needs a manual pass, not just triggers:

- Tools: connect, reconnect, connection manager
- Webhooks
- Projects and members CRUD
- Deployments (`runnable/deploy.ts` — 10 invalidations)
- Any optimistic toggle (the trigger play/pause is the known one)

For each: perform the mutation, confirm the UI settles with no reload. Record what you checked in
`plan.md` under WP3 so the next person knows the coverage.

## Task 5 — push and open the PR

Only after Task 3 passes.

```bash
git push -u origin fix/package-query-client
gh pr create --draft --base docs/sessions-ux-stack --head fix/package-query-client \
  --title "fix(frontend): package cache writes address the host's QueryClient" \
  --body-file <(...)
gh pr comment <number> --body "@coderabbitai review"
```

- **Draft**, like every other lane in this stack.
- Base is `docs/sessions-ux-stack` (PR #5894). A wrong base turns the diff into the whole stack.
- Verify on GitHub that **Files changed** shows only this lane's files.
- Push one branch at a time and confirm with `git ls-remote --heads origin <branch>` against
  `git rev-parse <branch>` — a batch push of many refs is rejected wholesale with `GH013`, and
  `git push` prints nothing useful on success.
- `gh pr edit` is broken on this repo (Projects-classic GraphQL error). To change base/title/body
  use `gh api -X PATCH repos/Agenta-AI/agenta/pulls/<n> -f base=... -f title=...`.

The PR body should say plainly that `/m` was the only affected host, that all package-layer cache
writes were silently dead there, and what was verified live vs only statically. The
`write-pr-description` skill has the format.

## Not in scope — leave alone

**WP4** (the `refetchOnWindowFocus: false` + `staleTime: 30_000` gap on the gateway queries, which
is why the Gmail OAuth return showed a stale drawer) is a behaviour change and belongs in its own
PR. Keep this lane a pure "which client is addressed" change.

## Conventions

- `web/AGENTS.md` for frontend rules; `agenta-package-practices` skill for package placement.
- Comments: at most one short line each.
- Never put "Claude", "Anthropic" or `Co-Authored-By` in a commit or PR.
- Gate on the tsc **error-signature diff**, not the count — the oss count fluctuates with cache
  state.
