# Kickoff — executing the observability extraction

Instructions for a fresh session picking up `plan.md` in this directory. Read this first,
then the plan.

---

## 0. Orientation (do this before touching anything)

Read, in order:

1. `plan.md` — the whole thing. It is ~600 lines; do not skim §3 or §5.
2. Root `AGENTS.md` — especially the GitButler sections. `but` **is** installed on this
   machine (an older note claiming otherwise is stale).
3. `web/AGENTS.md` / `web/CLAUDE.md` — import aliases, data fetching, the QueryClient host
   contract, styling.
4. The `agenta-package-practices` skill — package vs app placement, hierarchy, package
   tests. Load it before creating `@agenta/observability-ui`.
5. The `mobile-app-structure` skill — before WP6.

Then **re-run the whole of `plan.md` §9** and reconcile. The tree moves; the plan was
measured on 2026-08-11. If a number disagrees with the command, the command wins — fix the
plan in the same PR that discovers it.

---

## 1. Ground rules

These are the ways this work goes wrong. All five were established by investigation, not
preference.

1. **Extract, never hand-roll.** Every component is an OSS component moved onto plain
   elements. If you cannot point at the OSS original, stop — you are inventing. The plan
   flags the two places where no original exists; those are decisions, not licence.
2. **Do not port `@agenta/ui/table`.** Not in this stack. §8 sequences it separately. If a
   WP starts to feel like it needs the table ported, the WP is wrong, not the rule.
3. **Do not split `useObservability()`.** It returns 40 keys and that is ugly. Out of scope.
   Keep the signature identical so no call site changes.
4. **Read every file before moving it.** Three names lied in one afternoon
   (`sessionExistsAtom`, `assets/constants.ts`, the "Sessions" tab entity). Assume more.
5. **Desktop loses nothing.** §5 is the contract. Verify it *after each WP*, in the browser,
   in both themes — not once at the end.

---

## 2. Decisions

D1 is settled and recorded below. D2 still blocks WP5's session half; WP0–WP4 are
unaffected.

**D1 — `useEvaluatorReference` — RESOLVED (b).** The evaluator label is an injected prop:
`EvaluatorMetricsCell` takes `displayName`, the host resolves it, and the 721-LOC
reference-atom subtree stays in the app. Nothing here blocks WP3.

**D2 — the observability session row (blocks WP5's session half).** No OSS design exists,
and it is a *different entity* from `@agenta/sessions`. Options: (a) mobile stacks the WP3
cells in a host-owned layout, (b) design supplies a row and it lands in `observability-ui`.
**Default to (a) and keep moving.** (b) is a question for Arda/design, not something to
decide alone — ask, but do not block on the answer.

---

## 3. Start here: WP0

Small, mechanical, no open questions, unblocks everything. Concretely:

- `lib/hooks/useAnnotations/assets/{helpers,transformer}` + `services/annotations/api`
  → `@agenta/entities/annotation`
- `lib/traces/observability_helpers` → `@agenta/entities/trace/utils` (move whole; check for
  name collisions against the existing `selectors.ts` — there were none on 2026-08-11)
- `sanitizeDataWithBlobUrls` → `@agenta/shared/utils`
- Add a `workspaceMembersAtom` seam for annotation author attribution

**No value re-export shims.** `web/eslint.config.mjs` bans `export … from "@agenta/*"` in
`oss/src/**` and `ee/src/**`, so rewrite the call sites to import from the package and delete
the old OSS module. WP0 rewrote 30 import sites across 25 files — budget for that.

**Do not** move `sessionExistsAtom` — read the note in §3 WP0 of the plan for why.

---

## 4. The loop, per WP

```bash
# from web/
pnpm lint-fix                                    # required before every commit
pnpm --filter @agenta/oss exec tsc --noEmit      # the correct OSS tsc invocation
pnpm turbo run build --filter=@agenta/<package>  # each package you touched
pnpm --filter @agenta/<package> test             # where the package defines one
                                                 # (observability-ui had no test script until
                                                 #  a harness was added for it)

# antd gate for the new package (must print nothing)
grep -rn 'antd' packages/agenta-observability-ui/src
```

**Gate on the tsc error *signature diff*, not the count** — a count gate hides a new error
behind a fixed one.

Then the part that actually catches regressions: **run the app and click through §5.** Arda
runs the dev servers himself — ask for a URL rather than starting one. Verify in light *and*
dark.

---

## 5. Git workflow

One linear stack, PR bases chained (`AGENTS.md` § "Stacks are linear"). WP0 bases on the
release branch; every later WP bases on the branch below it.

The rules that bite, in short — read the full sections in `AGENTS.md`:

- Work **one lane at a time**: assign exactly that lane's files → `but commit <branch> --only`
  → **verify with `git show --stat --name-only <branch>`** → then the next lane. Never
  pre-stage several lanes.
- Use **cliIds** from `but status --json`, not paths — paths go stale after every mutation.
- `but push` prints nothing on success. Verify with `git ls-remote --heads origin <branch>`
  vs `git rev-parse <branch>`.
- Take `but oplog snapshot -m "..."` before anything risky. `but oplog restore <sha>` is the
  undo.
- Lane a test with the half that appears **last** — a green local run proves nothing when
  every lane is applied.

Commits and PRs: conventional format, area `frontend`. **Never** mention Claude, Anthropic,
or add a `Co-Authored-By` trailer. `gh pr edit` is broken here — use `gh api -X PATCH`. For
PR bodies use the `write-pr-description` skill.

---

## 6. Traps specific to this work

- **Tailwind globs.** Add `agenta-observability-ui` to the OSS `content` globs *and*
  mobile's `@source` list the moment the package exists. Miss it and its utilities silently
  never generate — this was the single most frequent failure in the sessions stack.
- **QueryClient.** Package code uses `getHostQueryClient()` from `@agenta/shared/api`,
  resolved per call, never at module scope. Lint-enforced, including dynamic imports.
- **`sessionCellStore`.** It exists because the table mounts rows in an isolated Jotai
  store. Move it verbatim. It looks like a hack because it is one, and it is load-bearing.
- **Tokens.** No `--ant-color-*`, no `border-0 border-b` in package components — both break
  on mobile. Never spell a bracketed Tailwind class inside a comment; the scanner reads it.
- **`assets/constants.ts` must be split** across WP2 and WP3, not moved whole.

---

## 7. Definition of done, per WP

A WP is done when: its files are in the package with shims at the old paths · OSS tsc has no
new error signatures · every touched package builds and its tests pass · the antd grep is
empty for the new package · `pnpm lint-fix` rewrites nothing · **§5 verified in the browser,
both themes** · the PR body states explicitly what (if anything) was left out and why.

---

## 8. What to report back

After each WP: what landed, what the §5 pass showed, and anything the plan got wrong.
Prefer a few lines over a wall of text.

Flag immediately, rather than working around it: any WP that seems to require porting the
table, any place where extraction would mean inventing a component, and D1/D2 if they
resolve differently from the defaults above.
