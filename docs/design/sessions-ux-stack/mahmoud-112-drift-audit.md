# Drift audit: Mahmoud's v0.112 fixes vs the extracted packages

**Status:** not started. This document is the brief for a fresh session.

## Objective

Mahmoud spent ~44 PRs fixing and refining the UI surfaces we shipped into
`release/v0.112.0`. In parallel we extracted those same surfaces into `@agenta/*` packages
(the sessions-UX stack, PRs #5865–#5894). The extraction may not have carried his fixes
across.

Produce a **complete inventory of Mahmoud's changes that are not reflected in the extracted
packages**, with enough evidence per item that someone else can act on it.

## Non-goals — read this twice

- **Do not implement anything.** No fixes, no ports, no "while I was there" edits.
- **Do not open PRs, push, rebase, or modify any branch.**
- Do not restructure the packages or the stack.
- Do not re-review code quality. A separate CodeRabbit pass already covered that
  (see `project-sessions-ux-coderabbit-pass` in memory).

The single deliverable is the inventory. If you find yourself editing a `.tsx` file, stop.

## Background: how the code actually moved

Three facts that make this audit non-obvious:

1. **Our UI work landed in 112 without merged PRs.** PRs #5767–#5776 are authored by
   `ardaerzin` and show as **CLOSED, not MERGED**. Mahmoud merged the underlying branches
   directly (look for merge commits into `rel112-merged` and `rebase/5766…`), then closed the
   PRs. Their commits *are* in `release/v0.112.0`. #5766 is the exception: closed, and its
   content is **not** in 112.
2. **Mahmoud then iterated on those surfaces**, in the app layer (`web/oss/src/**`), across the
   44 PRs listed below. All were merged by him into `release/v0.112.0`.
3. **Our stack extracts those surfaces into packages.** Files that lived in `web/oss/src/**`
   now live in `web/packages/agenta-*/src/**`, sometimes renamed, split, or re-composed. The
   app-layer originals were deleted or reduced to shims (and the shims themselves were dropped
   in #5887).

So a fix Mahmoud made to an app file can be silently absent from the package that replaced it,
with nothing in the git history flagging it.

## The two drift classes

Detect both. They need different methods.

### Class A — landed after the fork

Anything Mahmoud merged into `release/v0.112.0` **after** the stack's merge-base is definitionally
absent from the stack. Enumerate exactly:

```
cd <repo>
git fetch origin release/v0.112.0 docs/sessions-ux-stack
FORK=$(git merge-base origin/release/v0.112.0 origin/docs/sessions-ux-stack)
git log --oneline "$FORK"..origin/release/v0.112.0
```

Every commit in that range is a Class A candidate. Cheap, exhaustive, and it is the floor of
the audit, not the whole of it.

### Class B — landed before the fork, lost in extraction

Present in the stack's base but dropped when the file moved into a package, because the
extraction copied a pre-fix version of the file. **A commit-range diff cannot see these.**

This is the dangerous class and it is not hypothetical. The CodeRabbit pass found four
instances of exactly this shape, each caught only because a reviewer happened to look at that
lane:

- `useSessionCardVerbs` — the extraction dropped the `toSessionMenuEntries` conversion.
- `HomeTaskComposer` — OSS and the package copy diverged by ~170 lines; the stale-agent guard
  existed in only one.
- `resolveRangePreset` — "all time" silently changed meaning from `1970-01-01T00:00:00` to `""`.
- `linkScope` — `{agentId: viewAllHref ? null : agentId}` became a hardcoded `agentId: null`.

Assume there are more. Method for Class B is in step 4.

## Method

### Step 1 — establish ground truth refs

```
git fetch origin release/v0.112.0 docs/sessions-ux-stack main
FORK=$(git merge-base origin/release/v0.112.0 origin/docs/sessions-ux-stack)
TIP=origin/docs/sessions-ux-stack     # top of the extracted stack
REL=origin/release/v0.112.0           # where Mahmoud's fixes live
```

Record the resolved SHAs in the inventory header. Everything downstream is relative to these.

Note: `release/v0.112.0` has advanced since the stack was cut, and the stack's bottom lane
(`pkg/auth`) is *not* a descendant of the current `REL` tip. That is expected and pre-existing.

### Step 2 — triage Mahmoud's PRs

The 44 PRs he authored and merged into 112 are listed at the end of this document, already
partitioned. Work the **UI-surface** group first (~27 PRs). The runner/sdk/api group cannot
have been affected by a frontend extraction; the tests/CI group only matters if a selector
points at markup the packages changed.

For each candidate PR, get the file list:

```
gh pr view <n> --json files --jq '.files[].path'
```

Discard immediately if it touches no `web/oss/src/**`, `web/ee/src/**` or `web/packages/**` path.

### Step 3 — build the file-move map

For every app-layer file Mahmoud touched, answer: **where does that code live at `TIP`?**

Four possible answers, and the audit differs for each:

| Outcome | How to tell | What to do |
| --- | --- | --- |
| Still exists at `TIP`, same path | `git cat-file -e $TIP:<path>` | Class A check only (step 5) |
| Moved into a package | search the packages for the component/function name | Class B check (step 4) |
| Split into several files | one app file, several package files | Class B check against each |
| Deleted with no successor | nothing at `TIP` matches | Record as its own finding: the surface may be gone |

Useful starting points for the map:

```
git log --diff-filter=D --name-only "$FORK"..$TIP -- web/oss/src | sort -u   # deleted app files
git log --diff-filter=A --name-only "$FORK"..$TIP -- web/packages | sort -u  # added package files
```

`git log --follow` will not reliably track these moves; the extraction rewrote files rather
than renaming them. Match on exported symbol names and component names instead.

### Step 4 — Class B check (the careful one)

For each moved file, compare **the version Mahmoud left in 112** against **the version at `TIP`**:

```
git show $REL:web/oss/src/<old/path>.tsx     > /tmp/before.tsx
git show $TIP:web/packages/<new/path>.tsx    > /tmp/after.tsx
diff -u /tmp/before.tsx /tmp/after.tsx
```

The diff will be large and mostly legitimate (prop-driven refactor, antd removal, renamed
imports). **Do not report the refactor.** You are looking only for behaviour that existed in
`before` and has no equivalent in `after`. Concretely, walk Mahmoud's actual hunks:

```
gh pr diff <n> --patch > /tmp/pr<n>.patch
```

For each hunk, ask: *what did this change do?* Then find where that behaviour should live at
`TIP` and check whether it does. Verify by reading the new code, not by grepping for the old
text — the extraction renamed things, so a grep miss proves nothing.

### Step 5 — Class A check

For commits in the `"$FORK"..$REL` range, the change is absent from the stack by construction.
Still confirm the *target* still exists at `TIP` (the file may have been deleted or superseded),
and record whether the fix is still applicable or has been overtaken.

### Step 6 — write the inventory

## Inventory format

One entry per finding. Group by the package that should own the fix.

```markdown
### D-01  <one-line description of the missing behaviour>

- **Class:** A (post-fork) | B (lost in extraction)
- **Source:** PR #5xxx, commit <sha>, `web/oss/src/<path>`
- **Should now live in:** `web/packages/agenta-<pkg>/src/<path>` (or "no successor found")
- **What Mahmoud's change did:** 1–3 sentences, in behaviour terms, not diff terms.
- **State at TIP:** absent / partially present / present-but-different
- **Evidence:** the specific lines at `TIP` that show it is missing, or the fact that the
  symbol/branch does not exist. Quote them.
- **User-visible?** yes/no, and what a user would see.
- **Confidence:** high / needs-a-second-look
```

Rules for entries:

- **No entry without evidence.** "Probably missing" is not a finding. If you cannot prove
  absence, mark it `needs-a-second-look` and say what you could not determine.
- **One behaviour per entry.** A PR that fixed three things becomes three entries.
- **Say when something is already fine.** A short "verified present" list is as valuable as the
  gaps: it tells the next person where not to look.
- Rank the final list by user impact, not by PR number.

## Known traps

- **Two different `cn` helpers exist.** `@agenta/ui` (root) exports a plain join; `@agenta/ui/ui`
  exports `twMerge(clsx(...))`. A className override that works in one is silently a no-op in the
  other. If a Mahmoud fix was a className change, check which `cn` the new call site imports.
- **Mobile lacks tokens the desktop has.** `web/mobile` is Tailwind v4 with its own bridge and has
  none of the antd semantic tokens. A fix using `--ant-color-*` or a scale like `cyan-6` will not
  render on `/m` even if the code moved correctly.
- **Duplicated components.** At least one component (`HomeTaskComposer`) exists twice: an OSS copy
  and a package copy, rendered by different apps. When you find the "new" location, check whether
  there are two, and which app renders which.
- **`git log --follow` is unreliable here.** The extraction rewrote rather than renamed.
- **The stack's intermediate lanes are deliberately red** (lockfile, lint, tsc). Do not treat that
  as a finding; it is a recorded decision.

## Mahmoud's 44 PRs, triaged

All authored and merged by `mmabrouk` into `release/v0.112.0`.

### Group 1 — UI surfaces (work these first, 29)

`#5832` stop in-app template picks looping agent creation · `#5833` restore the sessions toolbar
layout, dropping the filters rail · `#5834` neutralize the dark shell rail's blue cast ·
`#5835` nudge the sidebar brand row · `#5836` shared page gutters and centered max-width column ·
`#5837` slim trackless scrollbars, app-wide · `#5838` give the templates gallery its baseAppURL ·
`#5839` show the agent overview without Classic Mode · `#5840` drop the Pinned heading row from
the sidebar sessions list · `#5841` grey resting icons in the overview Configuration card ·
`#5842` make the Pro Trial banner dismissible · `#5843` session rows match the homepage (pin,
status icons, sizes) · `#5845` collapse toggle in the agent-scoped sidebar · `#5846` templates
pages join the shared layout · `#5847` home scrolls with the page, rail stays pinned ·
`#5848` create-agent flow: picking a template IS creating the agent · `#5850` the 14px type scale ·
`#5851` centre the agent name against its avatar in the rail card · `#5852` project/org switcher
inside the agent-scoped sidebar · `#5857` the running-elsewhere strip stops accusing your own tab ·
`#5859` request_input renders its form again after transcript replay · `#5895` dropdown menus never
unmount after close (scroll-fade vs Radix Presence) · `#5901` Immer MapSet race crashes fresh
sessions on virtual-table pages · `#5906` playground error-state Try again actually retries ·
`#5909` connect-flow feedback: actionable errors, correct auth mode, working decline ·
`#5912` transcript replay respects a cancelled interaction's terminal status ·
`#5913` a pending interaction anywhere in the tab counts as awaiting ·
`#5903` agents name their own sessions and themselves · `#5908` pair the first-task rename_agent
call to rename_session

The last two are runner/sdk changes, included here deliberately: session naming has a UI surface,
so check how the session list, the tab rail and the sidebar render a renamed session.

### Group 2 — runner / sdk / api (almost certainly out of scope, 7)

`#5811` cap oversized gateway tool results · `#5812` clear not-configured status for tool and
trigger discovery · `#5813` resolve gateway tools independently · `#5814` use Composio v3.1
consistently · `#5902` empty vault reports a missing credential · `#5904` tell the model its
rendered-skills path · `#5910` answered approvals close before a sibling re-parks

Skip unless a Group 1 finding points at one. A frontend extraction cannot have dropped a runner
or SDK change; these appear only so the 44 add up and nobody wonders what happened to them.

### Group 3 — tests / CI / chore

`#5849` auto-review release/* PRs with CodeRabbit · `#5854` retire stale antd selectors ·
`#5855` stop swallowing strict-mode violations · `#5856` never track QA gate artifacts ·
`#5896` playground role-select selectors, apiBase, flaky retries · `#5900` retire stale Radix
selectors · `#5905` round 2 acceptance-test fixes · `#5914` select a registry row explicitly

These matter only in one direction: a selector Mahmoud fixed may now point at markup the packages
changed. Worth a single pass at the end, not up front.

### Excluded

`#5863` — merged by Mahmoud but authored by `ashrafchowdury`. Include it in the audit anyway
(it touches playground triggers); it is listed separately only because it is not his work.

## Budget guidance

This is a wide, shallow audit. Prefer breadth: every Group 1 PR gets looked at before any single
finding gets deep investigation. If you run low on context, the priority order is:

1. The Class A commit range (cheap, exhaustive, must be complete).
2. Group 1 PRs touching Home, agent overview, sessions list, templates. These are the surfaces the
   extraction rewrote most heavily.
3. Everything else.

Hand back a partial inventory with an explicit "not yet examined" list rather than a complete-looking
one that quietly skipped things.
