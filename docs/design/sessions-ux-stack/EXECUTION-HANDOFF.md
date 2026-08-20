# Execution handoff — closing the v0.112 drift

Everything a fresh session needs. Audit and planning are **done**; this is execution only.

## Read first, in this order

**All four docs are UNTRACKED** — they exist on disk only, in the `sessions-ux` worktree, and are in
no commit. A fresh worktree will not contain them. Read them at their absolute paths:

```
/Users/ardaerzin/Documents/GitHub/agenta_open_source/.claude/worktrees/sessions-ux/docs/design/sessions-ux-stack/
```

1. `mahmoud-112-drift-inventory.md` — 26 findings with evidence, the app→package move map, and the
   complete #5850 census.
2. `mahmoud-112-drift-remediation-plan.md` — 16 work packages, the file-lock table, the dispatch
   prompt template.

(`mahmoud-112-drift-audit.md` is the original brief; only needed for method archaeology.)

**Phase 0.2 must copy them into the new worktree** so they survive and so subagents can read them by
relative path — the copy step is in that section.

Do not re-derive the audit. It is finished and evidence-backed. If something looks wrong, check the
quoted evidence before re-investigating.

## Ground rules (these are what make parallelism safe)

- **Subagents author. They never run `git commit`, any `but` command, `gh`, `pnpm lint-fix`, or
  `pnpm install`.** Two agents running `but` concurrently scramble the GitButler stack; two running
  `lint-fix` fight. The main session does all of it, serially, at the end.
- **The file-lock table is a contract.** An agent that wants to touch a path outside its locks stops
  and reports instead.
- **Never conclude from a failed grep.** The extraction renamed and re-composed things; a grep miss
  proves nothing. Verify by reading the successor, using the move map.
- Do not "fix while you're there", refactor, or re-review code quality — a CodeRabbit pass already
  covered quality.

---

## Phase 0 — prepare (main session, do not skip)

### 0.1 Confirm the base

```bash
cd /Users/ardaerzin/Documents/GitHub/agenta_open_source
git fetch origin docs/sessions-ux-stack
git rev-parse origin/docs/sessions-ux-stack   # audit measured 15c246b334
```

The base is **`origin/docs/sessions-ux-stack`** — pushed, and what the 30 drafted PRs sit on. There
is also a divergent *unpushed* local line (`fix/oauth-callback-settle`); **ignore it**, and do not
work in the `sessions-ux` worktree, which holds ~118 uncommitted files from a different workstream.
If the tip has moved past `15c246b334`, spot-check three findings still reproduce (below) before
proceeding.

### 0.2 Clean worktree, which is also the landing lane

```bash
git worktree add .claude/worktrees/drift-fix -b fix/mahmoud-112-drift origin/docs/sessions-ux-stack

# The planning docs are untracked — carry them over, or nothing downstream can read them.
mkdir -p .claude/worktrees/drift-fix/docs/design/sessions-ux-stack
cp .claude/worktrees/sessions-ux/docs/design/sessions-ux-stack/mahmoud-112-drift-*.md \
   .claude/worktrees/sessions-ux/docs/design/sessions-ux-stack/EXECUTION-HANDOFF.md \
   .claude/worktrees/drift-fix/docs/design/sessions-ux-stack/

cd .claude/worktrees/drift-fix/web
pnpm install          # needed for tsc; one-off, slow
```

Commit the four docs as the lane's **first** commit, so the audit trail ships with the fix and
subagents can cite relative paths.

Plain git branch, not `but branch new` — authoring stays outside GitButler entirely. The lane is
PR'd with `--base docs/sessions-ux-stack` at the end.

### 0.3 Spot-check the findings still reproduce

```bash
cd .claude/worktrees/drift-fix
grep -c 'xs: \["13px"' web/oss/tailwind.config.ts                                   # expect 0
grep -c 'animate-none' web/packages/agenta-ui/src/components/ui/dropdown-menu.tsx   # expect 0
grep -n '^const stated' web/packages/agenta-entity-ui/src/agent/AgentConfigSummaryCard.tsx  # expect "complete"
```

All three should still show the defect. If any is already fixed, the tip moved — re-verify the
inventory before dispatching.

### 0.4 Capture the tsc baseline (before any edit)

```bash
cd .claude/worktrees/drift-fix/web
pnpm --filter @agenta/oss exec tsc --noEmit > /tmp/tsc-baseline.txt 2>&1; wc -l /tmp/tsc-baseline.txt
```

Gate later on the **error signature diff**, never the count — a count gate hides a new error behind
a fixed one.

### 0.5 Apply the lock-table amendments

The census found four paths with no owner. Apply the *"Lock-table amendments"* list at the end of the
inventory's census section to the plan's lock table **before dispatch**:

- `agenta-sessions-ui/src/{SessionFiltersBar,SessionFiltersPanel,SessionCardList,SessionListCard,SessionListPanel,controls/SessionFilterControls}.tsx` → **WP-1D**
- `agenta-home-ui/src/{TemplateGallery,AnalyticsRangePicker}.tsx` → **WP-1F**, and remove
  `TemplateGallery` from **WP-1D**'s locks
- `agenta-playground-ui/src/components/AgentPageHeader/AgentRevisionStatus.tsx` → **WP-1J**
- `oss/.../AgentChatSlice/assets/markdown.tsx` → **WP-1J**

---

## Phase 1 — WP-0A, then wave 1

**WP-0A first, alone** (one line, ~2 min): restore `xs: ["13px", {lineHeight: "18px"}]` to the
`fontSize` object in `web/oss/tailwind.config.ts`. Everything visual depends on it.

Then dispatch **nine agents in a single message** so they run concurrently:

| Agent | WP | Findings |
| --- | --- | --- |
| 1 | WP-1A | D-02, D-03, D-04 — `@agenta/ui` primitives |
| 2 | WP-1B | D-15…D-18 + census — navigation chrome |
| 3 | WP-1C | D-14 — sidebar session group headings |
| 4 | WP-1D | D-05, D-25 — browse-layout env flag |
| 5 | WP-1E | D-06…D-10, D-28 — create-agent flow |
| 6 | WP-1F | D-11, D-13, D-21 — home-ui panels |
| 7 | WP-1G | D-19, D-20 — entity-ui |
| 8 | WP-1H | D-23, D-24 — page gutters |
| 9 | WP-1J | D-22 + census — chat type scale |

Use the dispatch prompt template at the end of the plan verbatim, substituting the WP's IDs and
locks. **WP-1D and WP-1F must agree on the `layout` prop name** — say so in both prompts.

## Phase 2 — wave 2 (Class A ports)

Start **WP-2A, WP-2B, WP-2E** together once wave 1 is in.
Then **WP-2C** (needs WP-2B's `useAgentChatSession.ts`) and **WP-2D** (needs WP-1H's `Layout.tsx`
and WP-2B's `sessions.ts`).

## Phase 3 — verify (serial)

1. `pnpm --filter @agenta/oss exec tsc --noEmit` → diff signatures against `/tmp/tsc-baseline.txt`.
2. `pnpm lint-fix` in `web/` — once, by you.
3. Unit tests for every touched package: `agenta-navigation`, `agenta-sessions`, `agenta-entity-ui`,
   `agenta-chat`, `agenta-playground`, `agenta-shared`, `agenta-settings`.
4. `pnpm install` to regenerate `pnpm-lock.yaml` for WP-1A's `immer` dependency.
5. Browser QA — **Arda runs the dev server himself; wait for his URL.** Priority order in the plan's
   Wave 3 §5, which is ranked by finding impact.

## Phase 4 — land

Commit in WP order (one commit per WP, so each is reviewable), then:

```bash
git diff --name-only origin/docs/sessions-ux-stack..fix/mahmoud-112-drift
```

The file list must be exactly the union of the lock table — nothing else. Push, then **verify the
push landed by comparing SHAs** (`git ls-remote --heads origin fix/mahmoud-112-drift` vs
`git rev-parse fix/mahmoud-112-drift`); a silent `but push` is not confirmation, and
remote-tracking refs go stale and lie. Then
`gh pr create --head fix/mahmoud-112-drift --base docs/sessions-ux-stack`.

Commit messages: never mention Claude/Anthropic, no `Co-Authored-By`.

---

## Traps, all of which have already bitten

- **`gh pr view --json files` lies here.** Head branches moved after merge, so it reports files the
  merge commit does not contain — it claims #5848 *added* `CopiedToast.tsx`, which #5848 **deleted**.
  Always use `git diff <merge>^1 <merge>`.
- **A file can exist at the tip *and* have a package successor.** `ProjectOrgSwitcher`,
  `NewAgentButton`, `TemplateDetail` are oss shims *and* package components; checking only the
  surviving app path reports "fine" while the rendered component is stale. Use the move map.
- **Two `useCreateAgent` hooks exist.** WP-1E needs the oss one
  (`pages/agent-home/hooks/useCreateAgent.ts`, which seeds and navigates), **not**
  `@agenta/home-ui/src/useCreateAgent.ts`, which only mints and commits.
- **Two `cn` helpers exist.** `@agenta/ui` root exports a plain join; `@agenta/ui/ui` exports
  `twMerge(clsx(...))`. A className override is silently a no-op in the wrong one — this decides
  whether WP-1A's `animate-none` actually wins.
- **zsh:** `set -- $pair` inside a `for` loop silently misbehaves and inverted a whole
  classification; use `while read -r a b; do … done <<'EOF'`. And `git show "$REF:web/…"` must be
  **quoted** or zsh eats part of the path and git reports a bogus "unknown revision".
- **Do not run any Node/pnpm version preamble** — the toolchain is already Node 24.
- **The stack's intermediate lanes are deliberately red** (lockfile, lint, tsc). Not a finding.

## Definition of done

All 26 findings closed or explicitly deferred with a reason; tsc signature-clean against baseline;
lint clean; package unit tests green; QA'd in the browser; one PR open against
`docs/sessions-ux-stack` whose diff touches only lock-table paths.
