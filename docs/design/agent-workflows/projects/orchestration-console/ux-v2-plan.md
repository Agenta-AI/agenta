# Orchestration console — UX/UI review and V2 plan

Reviewed: the home/project-list page, a project page in light mode, and the same project in
dark mode with messages hidden. Code read: `tool/console_web.py` (the whole UI) and
`tool/console_store.py` (the data model). Scale today is small (2 projects, one with 12 tasks
and 8 threads), but the stated goal is many projects and many agents, so this review weighs
improvements against that target, not just today's screenshots.

The bottom line: the console already has the right bones (file-backed, server-rendered,
light JS). The gaps are not architectural. Most of them are a few lines of Jinja and CSS,
and one of the best fixes (a last-message preview) reuses a helper the store already has but
the web UI never calls.

## 1. Assessment

### What already works

- **The decision "Needs you" lane** is exactly right: full context, the agent's recommendation,
  and an inline answer box in one card. This is the model the rest of the page should follow.
- **Hide threads / hide messages** already declutters well. The toggles persist in
  `localStorage` and apply before paint, so there's no flash of the wrong state.
- **The dot in the title and favicon** (`dot="● " if waiting_on_user else ""`) is a cheap,
  effective "something needs you" signal, visible in a browser tab without opening the page.
- **The feed poll** on the project page (`setInterval(poll, 4000)` in `console_web.py`
  lines 336-350) already proves the pattern for lightweight self-refresh: fetch JSON, patch the
  DOM, no reload. It's just not used anywhere else yet.
- **Threads collapse by default once resolved** (`console_web.py` line 242), which is the
  right instinct. Tasks don't get the same treatment (see below).
- Light/dark theme, per-project unread badges, and the plain-file model all pull their weight
  without adding a build step.

### Pain points

1. **The project page is a long wall of cards.** The dark-mode screenshot shows roughly a
   dozen tasks, most marked `done`, each rendering full chrome: title, status pill, owner,
   context summary, a collapsed message count, and a full "Add a message" textarea with a Post
   button. None of that collapses. Threads already collapse when resolved
   (`console_web.py` line 242); tasks have no equivalent, so a finished task takes the same
   vertical space as a running one. At a dozen tasks this is already a long scroll; it will not
   scale to many agents across many projects.

2. **The last message is not visible without opening something.** A collapsed thread shows
   only its code, title, and status pill, no hint of what was last said. A task's messages sit
   behind a native `<details>` twistie, closed by default. The user's top priority is "see the
   last message at a glance," and today that means expanding every card. The frustrating part:
   `console_store.py` already has `Store._last_message()` (lines 946-958), used by
   `read_pending`/`read_updates` so the *agent* gets a one-line preview at the start of its
   turn. The web UI never calls it, so the human doing the same job by eye gets nothing.

3. **The toolbar is crowded.** The project page toolbar (`console_web.py` lines 206-218) has
   nine buttons plus the theme toggle: `← projects`, `Backlog`, `+ Ask`, `Note`, `Expand`,
   `Collapse`, `Hide threads`, `Hide messages`, `What's new`, `Dark`/`Light`. The dark-mode
   screenshot shows all ten in one sticky row. Four of them (`Expand`, `Collapse`, the two
   `Hide` toggles) are view settings a user sets once per session, not per-visit actions, but
   they sit at the same visual weight as `+ Ask`.

4. **Switching projects means going back to the list.** The only way off a project page is
   `← projects` (back to Home) or `Backlog`. There's no way to see or jump to another project's
   state from inside a project. For "many projects," this is a full round trip per switch.

5. **No cross-project "needs you" view.** Home already shows a `needs` badge per project
   (`console_web.py` lines 434-436), which is good, but it's a count, not a list. To actually
   act on what needs a decision, the user opens each project in turn. There's no single place
   that lists every open decision, waiting thread, and flagged task across all projects.

6. **The page doesn't refresh itself at the level that matters.** The project page polls only
   the feed strip; a brand-new decision or a status change elsewhere on the page needs a manual
   reload to show up. Home never polls at all, so the project list's `needs`/`unread` badges
   are only as fresh as the last time the user hit Home.

7. **Home's project order is arbitrary.** `list_projects()` (`console_store.py` line 292)
   returns projects in directory (alphabetical) order. There's no reordering by urgency, so a
   project with "2 need you" can sit below one with nothing outstanding, if its name sorts
   later. At 2 projects this is invisible; at 20 it's the difference between glancing at the
   top of the list and reading the whole thing.

## 2. Prioritized improvements

Ordered by value against effort. "S" is a small, mostly template/CSS change with no new route.
"M" is a small new route or aggregation but still server-rendered, no new framework.

**P1. Sort Home by urgency, not alphabetically (S).**
Problem: pain point 7. Solution: in `home()`, sort `rows` by
`(needs desc, unread desc, updated desc)` before rendering. All the data is already computed
per row; this is a one-line sort added to an existing loop.

**P2. Show a one-line last-message preview on thread and task cards (S).**
Problem: pain point 2. Solution: call the existing `Store._last_message()` for each thread and
task in the `project()` route, and render it as a muted, truncated line under the title/pill
row, visible even when the card is collapsed. No new logic: the store already builds this
string for the agent's read path; the web route just needs to also call it and the template
just needs to print it.

**P3. Collapse tasks like threads, default-collapsed when done or dropped (S).**
Problem: pain point 1. Solution: give task cards the same `thead`/caret/`collapsed` treatment
threads already have (`console_web.py` line 242 and the `.collapsed .tbody{display:none}` CSS
rule), collapsed by default for `done`/`dropped`. Pair with P2 so a collapsed task still shows
its status and last message. One gotcha to carry along: `setAll(collapsed)`
(`console_web.py` lines 323-328) currently only toggles `.thread` elements; extend it to also
toggle `.task` so the existing Expand/Collapse buttons keep working on tasks too.

**P4. Fold the toolbar's view settings into one small menu (S).**
Problem: pain point 3. Solution: a native `<details class=menu><summary>View ▾</summary>...
</details>` holding `Expand`, `Collapse`, `Hide threads`, `Hide messages`, and `What's new`,
positioned with a couple of CSS lines (`position:relative` on the `details`,
`position:absolute` on the panel). No JS beyond the native disclosure element already used
elsewhere in the page (`<details id=feedwrap>`). Keep `← projects`, `Backlog`, `+ Ask`, `Note`,
and the theme toggle as direct buttons: those are the ones used every visit.

**P5. A cross-project "needs you" view (M).**
Problem: pain point 5. Solution: a small new aggregation on `Store` (loop `list_projects()`,
pull each project's `open` decisions, `waiting` threads, and `needs_reply` tasks, same loaders
`project()` already calls) rendered as one flat list of cards, each tagged with its project and
linking back to the exact anchor (`/p/{pid}#decision-{id}`). Reuses the existing `.card`/
`.pill`/`.needs` CSS; no new JS. This is the one place that answers "where, across everything,
do I need to act" without opening every project. Its payoff grows with project count; worth
building once there are more than a handful of projects.

**P6. Extend the poll pattern to Home and to project-level counts (S/M).**
Problem: pain point 6. Solution: copy the pattern already proven by the feed poll
(`console_web.py` lines 336-350). Add one small `/summary.json` endpoint that returns the same
per-project counts `home()` already computes, and a `setInterval` on Home that patches the
`needs`/`unread` pill text in place. On the project page, do the same for the "Needs you"
count so a newly raised decision shows up without a reload. Keep it to patching numbers and
badges, not re-rendering whole sections.

**P7. A quick project-switch strip, evaluated against a full sidebar (S).**
Problem: pain point 4. The suggested persistent left sidebar was evaluated and set aside: this
app is one centered 840px column, in one CSS file, and a real sidebar means a two-pane layout
landing in every template plus responsive handling for narrow windows. That's real layout
surgery for a tool whose whole design point is staying a single file. Instead: a slim
horizontal strip of project pills under the toolbar (reusing the existing `.pill`/`.badge`
styles and the same counts Home already computes, factored into one small shared helper),
each linking straight to that project, current project shown disabled/bold. Same "jump fast,
see the dots" value, none of the layout cost.

**P8. A small set of keyboard shortcuts (S, optional).**
Problem: faster navigation for a single power user. Solution: one `keydown` listener added to
the existing inline `<script>` block, guarded so it ignores keystrokes while focus is in a
textarea or input. A handful of bindings is enough: `a` focuses the ask box, `n` focuses the
note box, `e`/`c` expand/collapse all. Keep the set small; this is a nice-to-have, not a
priority against P1-P6.

## What to avoid

Called out so V2 doesn't drift toward complexity the tool is explicitly built to avoid:

- No SPA framework, no client-side router, no build step. Everything above is server-rendered
  Jinja plus the vanilla JS already in the file.
- No websockets. The 4-second poll already in use is fine at this scale; extending it (P6) is
  enough.
- No two-pane/sidebar layout system (see P7's reasoning above).
- No database. Aggregation for P5 is a loop over the same Markdown files the CLI already
  writes.
- No drag-and-drop, no per-user auth/roles, no notifications system. None of these were asked
  for, and each would pull in state or infrastructure the file-only model doesn't have.

## 3. Phased V2 plan

**Phase 1 — Glanceability and declutter (P1, P2, P3, P4).**
All four are template/CSS changes to the pages that already exist, with one small store call
(`_last_message`) reused rather than built. No new routes. This is the fix for the wall-of-cards
problem visible in the screenshots today, and it's worth shipping as one slice: P2 and P3 touch
the same card markup, and P4 is independent but equally cheap.

**Phase 2 — Cross-project navigation (P7, P5, P6).**
The quick-switch strip (P7) and the cross-project needs-you view (P5) are the direct answer to
"interact with many agents across many projects." P6's polling extension pairs naturally with
P5: once there's a place that aggregates state across projects, it should also refresh itself.
This phase adds one or two small routes; still no client framework.

**Phase 3 — Power-user polish (P8).**
Keyboard shortcuts. Small, optional, and lowest priority: real value once the rest is in place,
but it doesn't fix a pain point on its own.
