# Kickoff — executing the observability chrome conversion

Instructions for a fresh session. Read this, then `plan.md`.

This work is **designed for parallel sub-agents**. §3 is the dispatch table. Read §1 and §2
first — they are the difference between five agents helping and five agents colliding.

---

## How to run this (one session, not eight)

Start **one** new Claude Code session and paste:

> Read `docs/design/observability-chrome/KICKOFF.md`, then
> `docs/design/observability-chrome/plan.md`.
> Work in this worktree, on the branch it already has checked out — confirm both with
> `git rev-parse --show-toplevel` and `git branch --show-current` before you start.
> Execute the chrome conversion. Dispatch the waves in §3 using sub-agents, sending each wave's
> agents in a single message so they run in parallel, using the prompts in
> `docs/design/observability-chrome/agent-prompts.md`
> verbatim as their payloads. Report back after each wave before starting the next.

That session is the **orchestrator**. It does not write component code itself — it dispatches,
collects reports, resolves the `exports.md` handoffs between waves, and runs the serial
integration phase at the end.

`agent-prompts.md` is a reference the orchestrator reads. You never dispatch those eight prompts
by hand.

Practical notes:

- **Wave 2 is the expensive one** (4 agents). Wave 1 is 2 short agents; Wave 3 is 1.
- The orchestrator must **wait for a wave to finish** before starting the next — Wave 2 needs
  P0-B's cascader verdict and P0-A's export name.
- If you would rather run it incrementally, the waves are independent enough to do on separate
  days. Wave 1 alone is a useful, self-contained first step.
- T5 can be its own session entirely. It is the only track that touches app files outside the
  integration phase, and it must never overlap with Wave 3.

---

## 0. Orientation

Read, in order:

1. `plan.md` — all of it. It is short by design.
2. `../observability-packages/plan.md` §5 (the no-functionality-removal checklist) and its
   "Claims that were wrong in earlier drafts" table.
3. Root `AGENTS.md`, `web/AGENTS.md` / `web/CLAUDE.md`.
4. The `agenta-package-practices` skill.

Then **re-run `plan.md` §7** and reconcile. If a number disagrees with the command, the command
wins; fix the plan in the same PR that finds it.

The stack this builds on is `obs/wp0-entities-prep` → `obs/wp1-observability-state` →
`obs/wp2-filter-engine` → `obs/wp3-observability-ui`. Base new work on **`obs/wp3`**.
Only its tip is verified green — the intermediate lanes were split from a single working tree
by decision and may not build standalone. Do not treat a red `obs/wp1` as a regression.

---

## 1. The parallelism contract (read before dispatching anything)

**Agents write NEW files inside packages. No agent edits an OSS file.** All OSS rewiring
happens once, serially, in phase I. This is the entire reason the tracks do not conflict:
`Filters.tsx` is never edited by four agents — it is deleted at the end and replaced by a
composition of independently written files.

Each agent owns a disjoint file set:

| Track | Owns (creates) | Must not touch |
| --- | --- | --- |
| P0-A | `packages/agenta-ui/src/components/ui/date-range-picker.tsx` (+ its export line) | anything else |
| P0-B | `packages/agenta-ui/src/components/ui/tree-select.tsx` **only if cascader fails** | anything else |
| T1 | `packages/agenta-observability-ui/src/toolbar/**` | `filters/`, `range/` |
| T2 | `packages/agenta-observability-ui/src/range/**`, `packages/agenta-home-ui/src/AnalyticsRangePicker.tsx` | `toolbar/`, `filters/` |
| T3 | `packages/agenta-observability-ui/src/filters/{FilterDialog,FilterRow}.tsx`, `packages/agenta-observability/src/filters/dialogHelpers.ts` | `filters/AnnotationFilterRow.tsx` |
| T4 | `packages/agenta-observability-ui/src/filters/AnnotationFilterRow.tsx` | `FilterDialog.tsx`, `FilterRow.tsx` |
| T5 | `packages/agenta-ui/src/table/**` (ColumnDef), `getObservabilityColumns.tsx` Tag swap | everything else |

**Shared files are the collision risk.** `packages/agenta-observability-ui/src/index.ts` and
each `package.json` will be touched by several tracks. Rule: **agents do NOT edit the barrel or
package.json.** They report the exports and dependencies they need; the integrator adds them in
phase I. An agent that cannot resist should instead append to
`docs/design/observability-chrome/exports.md`.

T5 is the exception that proves the rule — its `ColumnsType` work touches 22 OSS files. Run it
**alone**, either before the others or after integration, never concurrently.

---

## 2. Ground rules

These cost real time this session. All were established by investigation.

1. **Extract, never hand-roll.** Every component is an existing component moved onto
   primitives. `AnalyticsRangePicker` already exists — reuse it. `EnhancedButton` already
   exists. `planInputs` / `reconcileFilterRows` / `normalizeFilter` are already packaged and
   tested — call them, do not re-derive their logic in a component.
2. **Read the file before moving it.** Names lie here. `assets/constants.ts` held two unrelated
   exports; `assets/utils.ts` mixed operator sets with a tree-search helper;
   `Filters/types.d.ts` mixed a portable model with antd-typed props.
3. **Packages ban `any`** (`@typescript-eslint/no-explicit-any: error`) and both new packages
   had zero. Every moved file gets retyped. Budget for it — ~45 `any` came out of WP1 alone.
4. **OSS/EE ban re-export shims.** `export … from "@agenta/*"` is lint-blocked in `oss/src` and
   `ee/src`. You must rewrite call sites and delete the old module. The one exception is a
   **type-only** re-export (`import type` + a no-source `export type`), which is not matched by
   the rule and erases at compile time — use it for widely-imported types, never for values.
5. **Desktop loses nothing.** `plan.md` §5 is the contract. Verify in the browser, both themes.

---

## 3. Dispatch

### Wave 1 — primitives (2 agents, parallel)

Dispatch P0-A and P0-B together. Both are self-contained and block later tracks.

**P0-A prompt sketch:** *Build `DateRangePicker` in `@agenta/ui/src/components/ui/`, matching
the conventions of the existing files there (Radix + `cn` from `../../utils/styles`). It
replaces antd `DatePicker` in `web/oss/src/components/Filters/Sort.tsx` — read that file's
custom-range branch first. It must emit `{startTime, endTime}` as ISO strings.
Take `dayjs` through the shared wrapper (`@agenta/shared/utils/dateTime`) rather than adding a
direct dependency — that is what shipped, and it keeps one date surface across the packages. Do
not edit `ui/index.ts`; report the export line instead.*

**P0-B prompt sketch:** *Decide whether `@agenta/ui/src/components/ui/cascader.tsx` can replace
antd `TreeSelect` at `web/oss/src/components/Filters/Filters.tsx:1395`, which renders
`AttributeKeyTreeOption[]` (searchable, arbitrarily nested, single-select, `treePath`-scoped).
Read both. If cascader works, write nothing and report that. If not, build `tree-select.tsx`.
Report which, and why.*

### Wave 2 — components (4 agents, parallel, after Wave 1)

T1, T2, T3, T4 in one dispatch. T1 has no Wave-1 dependency and can start earlier if you like.

Give every agent: this file's §1 and §2, `plan.md`, and its row of the ownership table.

**Sequencing note:** T3 and T4 both consume WP2's filter engine but write different files. T4's
sub-row is embedded in T3's row at integration time; T4 should export a component with an
explicit props contract and **not** assume how T3 lays it out.

### Wave 3 — integration (1 agent, serial)

Composes desktop, deletes `Filters.tsx` / `Sort.tsx` / the antd in `ObservabilityHeader`, adds
the barrel exports and dependencies the tracks reported, runs the gates, does the browser pass.

### T5 — anytime, alone

Never concurrent with Wave 3.

---

## 4. The loop, per track

```bash
cd web
pnpm lint-fix
pnpm --filter @agenta/oss exec tsc --noEmit > /tmp/t.txt 2>&1; echo "exit=$?"
pnpm turbo run build lint --filter=@agenta/<package>
pnpm --filter @agenta/<package> test   # only where the package defines a test script

# antd gate for both UI packages (must print nothing).
# Paths are relative to web/ — this block already ran `cd web`.
grep -rn 'from "antd"\|from "@ant-design' packages/agenta-observability-ui/src
```

**Capture `$?` directly into a file. Never pipe tsc to `head`/`grep` and read the exit code** —
you get the pipe's status, not tsc's. That produced a false "OSS tsc clean" this session.

Gate on the tsc error **signature diff**, not the count.

---

## 5. Traps specific to this work

- **Never rewrite imports with a path-suffix regex.** `assets/constants` is a filename used by
  ~40 unrelated OSS modules (agent-home, TemplateStrip, Webhooks, `state/app`). A suffix match
  clobbered every one of them. Anchor on the **full specifier**, and diff the touched-file list
  against the expected list before continuing.
- **Tailwind globs.** Any new package must be added to `oss/tailwind.config.ts` `content` **and**
  mobile's `@source` list in `mobile/src/styles/globals.css`, or its utilities silently never
  generate. `observability-ui` is already in both.
- **Tokens.** No `--ant-color-*` and no `border-0 border-b` in package components; both break on
  mobile. Never spell a bracketed Tailwind class inside a comment — the scanner reads it.
- **`FilterValue` is deliberately `object`, not `Record<string, unknown>`.** Interfaces have no
  implicit index signature, so the stricter form rejects every named filter-value type. Do not
  "tighten" it.
- **`reconcileFilterRows` preserves array length and per-index order** because the dialog mutates
  state by index. Any new dialog must keep that contract.
- **`sessionCellStore` is load-bearing.** It exists because the table mounts rows in an isolated
  Jotai store. Do not clean it up.
- **Resizing the browser viewport desyncs the resizable-column table** — headers and body drift
  apart and columns look blank. That is a QA artifact, not a bug. Reload before judging.

---

## 6. Definition of done, per track

Files exist in the package · OSS tsc has no new error signatures · touched packages build, lint
and test · the antd grep is empty · `pnpm lint-fix` rewrites nothing · the track reported its
needed barrel exports and dependencies rather than editing shared files.

For Wave 3 additionally: `plan.md` §5 verified live in both themes, antd originals deleted, and
the PR body states what was left out and why.

---

## 7. What to report back

Per track: what landed, what the plan got wrong, and anything the ownership table failed to
cover. A few lines beats a wall.

Flag immediately rather than working around: any track that needs to edit an OSS file before
Wave 3, any place where extraction would mean inventing a component with no original, and P0-B's
cascader verdict.

---

## 8. Git

One linear stack on top of `obs/wp3-observability-ui`, PR bases chained. GitButler is installed
but **not configured for this worktree** — use plain `git`. Conventional commits, area
`frontend`. Never mention Claude or Anthropic and never add a `Co-Authored-By` trailer.
`gh pr edit` is broken here; use `gh api -X PATCH`. Use the `write-pr-description` skill for
bodies.

If you split a pile of parallel work into lanes afterwards, snapshot first (`git checkout -b
wip/… && git add -A && git commit`), build lanes by `git checkout <snapshot> -- <paths>`, and
verify the tip tree matches the snapshot before deleting it. Check for files you did not create
— this worktree carries unrelated untracked docs from other work
(`docs/design/oauth-callback-settle/`, `docs/design/sessions-ux-stack/`) that must stay out of
your commits.
