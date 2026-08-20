# Handoff: reconciling `lane/mobile-extracted-packages` with v0.112.0/.1/.2

## What this is

The team merged **51 PRs** onto the v0.112 release line *after* our drift audit was taken. The lane
has since absorbed the original drift fixes, but nothing from those 51 PRs. This workstream finds
what of that new work is missing from — or will land wrong in — the extracted packages, and plans
how to bring it across.

**In scope:** everything merged onto `release/v0.112.0` after `4af155162b`, plus all of
`release/v0.112.1` and `release/v0.112.2`.

**Out of scope:** the original 26 drift findings
([`mahmoud-112-drift-inventory.md`](mahmoud-112-drift-inventory.md)). Most already landed on the
lane. Their status is a **separate** verification pass — do not re-open them here, and do not trust a
grep to tell you they are open (the lane may implement the same behaviour differently; that is
exactly the trap the original audit warned about).

## Ground truth

| Ref | SHA |
| --- | --- |
| Fork point (lane's merge-base with every release branch) | `613368b81b94e4e5f8bcb1447857e61105b62ef1` |
| Audit-time tip — **the scope boundary** | `4af155162be0dd25ba00792c20b3d296a3a9b21e` |
| `release/v0.112.0` | `ab084b5335ea476eaf1b24a4e8d6d8038c4b8054` |
| `release/v0.112.1` — **the real reconcile target** | `19b9ab236796263cc281115a2e572eefb1bb9d7d` |
| `release/v0.112.2` | `247caebc7cb9afea3f48fbe64114c513b0f4b317` |
| Lane tip (PR #6065) | `7d2cd2ce89cb7d6f687569caa131054742788e76` |

The chain is strictly linear: `0.112.0` ⊂ `0.112.1` ⊂ `0.112.2`. **`0.112.2` contains no code** —
13 version-bump files only. Reconcile against `0.112.1`; `.2` follows for free.

## Read first

1. [`v0112-post-audit-scope.md`](v0112-post-audit-scope.md) — **the brief.** The 51 PRs tabulated by
   segment and area, the collision analysis, the A1/A2/B/C-dual buckets, and the 45-file re-homing
   table. Everything below assumes it.
2. [`mahmoud-112-drift-inventory.md`](mahmoud-112-drift-inventory.md) — read **only** its
   *"app → package move map"* section. That table is the tool this job runs on; the findings are not.

---

## The method — this is the whole job

A conflict-based merge is not a safety net here. Of the 239 app-layer files the release changed since
the fork, only some announce themselves:

| Bucket | Files | Merge behaviour | What it needs |
| --- | --- | --- | --- |
| **A1** lane moved it into a package | 47 (45 non-test) | modify/delete conflict | Re-home the fix into the package |
| **A2** release created it after the fork | 63 (25 non-test) | adds to app layer | A placement decision: app or package |
| **B** lane made it a shim | 2 | **clean** | Fix belongs in the package |
| **C-dual** app file *and* package twin | 7 | **clean** | Fix belongs in whichever copy renders |
| C-rest | ~120 | clean | Nothing — a normal merge is correct |

**A1's danger is volume, not invisibility.** Git flags all 45 as modify/delete. The loss happens at
resolution: 45 conflicts that each read "we deleted this, keep it deleted" discard 45 fixes, one
reflexive keystroke at a time. Every one needs an individual decision.

**B and C-dual are the silent nine.** They merge clean and put the fix in a copy the app no longer
renders. They are listed by name in the scope doc.

### The question to ask per changed app file

Never "does it merge cleanly". Instead:

1. Does the path exist on the lane? **No** → A1 or A2; check whether it existed at the fork point to
   tell which.
2. **Yes** → is it a thin re-export shim, or does a package twin exist? → the fix belongs in the
   package, not where it merged.
3. Neither → a normal merge is correct.

This is the drift audit's Step 3 run *forward* against new work instead of backward against old.

### Known limit of the existing analysis — close this first

The nine silent files were found by **basename matching** against the lane's package tree. Any
package copy that was **renamed** during extraction will not appear. Several were:
`AgentConfigurationCard` → `AgentConfigSummaryCard`, `UsageSummary` → `UsageCard`,
`SidebarMenu` → `NavMenu`, `TemplatesGallery/TemplateSection` → `TemplateGallery`.

**So the silent set is a floor, not a ceiling.** Re-derive it against the move map, matching on
exported symbol names rather than filenames, before trusting any count.

---

## Phase 1 — build the inventory (analysis only, no code changes)

Work the 51 PRs from the scope doc. Segment A (25 PRs, still on `0.112.0`) first — it is closest to
the surfaces the lane rewrote. Then Segment B (26 PRs).

For each PR:

```bash
git diff --name-status <merge>^1 <merge>     # authoritative — see the gh trap below
```

Bucket every changed `web/` path with the question above, then for anything landing in A1/B/C-dual,
read the hunks and record **what behaviour** the PR added and **where it must live on the lane**.

Use the drift inventory's entry schema (class, source, should-now-live-in, what it did, state on the
lane, evidence, user-visible, confidence). **No entry without evidence.** A failed grep proves
nothing — verify by reading the successor.

Skip: pure `api/`, `sdks/`, `services/` PRs (a frontend extraction cannot have dropped them), the two
promotion merges, all-contributors, and automated api-docs regeneration. The scope doc marks them.

**Deliverable:** `docs/design/sessions-ux-stack/post-112-reconcile-inventory.md` — findings ranked by
user impact, plus a "verified present" list and an explicit "not yet examined" list.

## Phase 2 — plan the work

Then, and only then, produce
`docs/design/sessions-ux-stack/post-112-reconcile-plan.md`, following the structure of
[`mahmoud-112-drift-remediation-plan.md`](mahmoud-112-drift-remediation-plan.md): work packages with
**disjoint file locks**, dependencies, definition of done, and dispatch prompts. That structure is
what let the first round run nine agents in parallel; reuse it rather than inventing one.

Decisions to surface rather than assume:

- **The three provider PRs** (#5995, #5994, #6001 — 478 files together) are mostly API/SDK with a
  frontend surface. In scope for this lane, or a follow-up?
- **A2's 25 new files** need a placement call: do they stay app-layer, or do they belong in packages
  now that the extraction exists? Answering per-file is the point; answering "all one way" is not.
- **#6018 `fix/sidebar-rail-alignment`** overlaps the original drift findings D-15/D-16/D-17. Check
  whether it supersedes, duplicates, or contradicts what the lane already has.

---

## Traps

- **`gh pr view --json files` lies on this repo.** Head branches moved after merge, so it reports
  files the merge commit does not contain — it claims #5848 *added* `CopiedToast.tsx`, which that PR
  **deleted**. Always `git diff <merge>^1 <merge>`.
- **Do not count promotion merges as work.** #5827 (846 files) and #5988 (380) merely promote
  `0.112.0`→`0.112.1` and `0.112.1`→`0.112.2`. Counting them inflates scope by ~1226 file-changes
  already counted elsewhere.
- **A file can exist on the lane *and* have a package twin** — `ProjectOrgSwitcher`,
  `NewAgentButton`, `TemplateDetail` are app shims *and* package components. Checking only the
  surviving app path reports "fine" while the rendered component is stale.
- **`git log --follow` is unreliable here** — the extraction rewrote rather than renamed. Match on
  exported symbol names.
- **Token-layer changes degrade everything at once and hide well.** #5973 `chore/palette-cleanup`
  (51 files) touches the palette, and the lane's `theme-variables.css` lives in `@agenta/ui`. That is
  the same shape as drift finding D-01, which was a single deleted line inside an unrelated commit.
- **zsh:** `set -- $pair` inside a `for` loop silently misbehaves — it once inverted an entire
  classification. Use `while read -r a b; do … done <<'EOF'`. And quote `git show "$REF:path"` or zsh
  eats part of the path and git reports a bogus "unknown revision".
- Do not re-review code quality; a CodeRabbit pass covered it. Do not edit `.tsx` files in Phase 1.

## Working rules

- **Phase 1 is read-only.** No branch is created, pushed, rebased or committed. Read-only git
  (`log`, `diff`, `show`, `merge-base`, `cat-file`) and `gh` are fine.
- Cover every Segment A PR before going deep on any single finding. Breadth first.
- If you run low on context, hand back a partial inventory with the gaps **named**, rather than a
  complete-looking one that quietly skipped things.
