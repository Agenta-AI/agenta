# Live QA matrix

Nothing below has been run. The frontend work is complete and green on unit tests, types and
lint; this is what a browser pass has to confirm before the step ships.

Flag: `NEXT_PUBLIC_AGENT_CONNECT_STEP` (default on). Flip to `false` for the regression rows.

## Setup

Both onboarding surfaces need a project with **zero agents** (first run is decided by agent
count). `?firstRun=1` on `/apps` forces the Home surface without touching the agent count, but
it does **not** trigger the playground-native redirect — that gate reads the real count.

Have one integration already connected in the workspace (GitHub is easiest) and one not, so the
"already connected" and "needs connecting" rows both appear in the same card.

## A. Free text — Home first run

| # | Do | Expect |
| --- | --- | --- |
| A1 | Type "Triage new GitHub issues and post a daily digest to Slack", press Create | No agent created. The description settles to a line with **Edit**; the card appears below it; the template strip hides. |
| A2 | Read the rows | GitHub then Slack, in that order. Neither shows a **Required** pill. Create is enabled from the start. |
| A3 | Press **Edit** | Back to the composer with the text restored, card gone, strip back. |
| A4 | Connect Slack via the row | OAuth popup; on return the row flips to **Connected** without a reload. |
| A5 | Skip GitHub | Row dims, subtitle becomes "Skipped — the agent can ask later", **Undo** replaces Connect. Create stays enabled. |
| A6 | Press Create | Agent is created and the playground opens. The first turn reads as one message: the description, then "I've connected Slack. I've skipped GitHub for now — ask me when you need it." |
| A7 | Type "An agent that writes release notes", Create | Card says **"Any accounts to connect?"**, no rows, suggestion chips + Search all, footnote "Nothing required.", Create enabled. |
| A8 | Press Create from A7 without touching anything | Seed is exactly what was typed — no appended line. |

## B. Template — Home first run

| # | Do | Expect |
| --- | --- | --- |
| B1 | Click a template card with required integrations | The step opens (it no longer creates straight away). |
| B2 | Read the rows | Every declared integration is present with a **Required** pill and the template's own scope line as the subtitle. |
| B3 | Look at Create | **Disabled**, footnote names what is missing ("Connect GitHub to create." / "Connect GitHub and Slack to create."). |
| B4 | Look for Skip on a required row | There is none. |
| B5 | Connect each required one | Create enables the moment the last one connects; badge flips to **All set**. |
| B6 | Press Create | Agent created under the template's name, seeded with the builder message plus the connected line. |

## C. Playground-native onboarding

| # | Do | Expect |
| --- | --- | --- |
| C1 | Land on `/playground` first run, type a description, press Create agent | **The composer keeps its text.** No message appears as sent, the hero stays, and the card docks above the composer where the template strip was. |
| C2 | Read the card's placement | Same column as the composer, same spot the agent's own mid-run connect card uses. |
| C3 | Press Create in the card | Now the optimistic user turn appears, the composer clears, and the commit runs — the same transition a template click already produced. |
| C4 | Pick a template from the in-playground strip / gallery | Opens the step too (D3), same as B. |
| C5 | Force a commit failure (offline) | The card stays, Create re-enables, nothing is stranded. |

## D. Regression — flag off

Set `NEXT_PUBLIC_AGENT_CONNECT_STEP=false` and recreate web.

| # | Do | Expect |
| --- | --- | --- |
| D1 | Home: type a description, Create | Creates immediately, no step. Exactly today's behaviour. |
| D2 | Home: click a template | Creates immediately. |
| D3 | Playground: Create agent | Optimistic turn appears and composer clears, as before. |
| D4 | Seed content | No appended line anywhere. |

## E. Cross-cutting

| # | Check | Note |
| --- | --- | --- |
| E1 | Dark mode, every card state | The card uses only `--ag-*` tokens; required/connected rows read correctly on both grounds. |
| E2 | `/m` (mobile) | `AccountRow` moved into a shared package. `@agenta/entity-ui/src/**` is already covered by an `@source` line in `web/mobile/src/styles/globals.css` (verified), so the classes generate. Borders are written longhand (`border-x-0 border-t-0 border-b`) for Tailwind v4. Nothing on `/m` renders the card yet — this row is only about the drawer's shared row not regressing. |
| E3 | Template setup drawer (`NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER=false`) | It now renders the extracted `AccountRow`. Its rows and its "{n} left" counter must be unchanged. |
| E4 | Mid-run `request_connection` | Still works for anything skipped — the step adds a gate, it removes nothing. |
| E5 | A connection made in the step | Is workspace-scoped, so a second agent created afterwards shows it already connected. |

## Known gaps to watch for

- **Detection is string matching.** "post to my team chat" finds nothing. That is by design
  (D2) — check that the empty state reads as an offer, not a failure.
- **The preamble is visible** in the first turn. E2E, read it as a user would: does it sound
  like something they wrote? If not, that is a copy fix in `PERMISSION_OPTIONS` /
  `buildSetupPreamble`, not an architecture change.
- **Suggestion chips are a fixed list** (`COMMON_SLUGS`), not ranked. If they look arbitrary
  next to real descriptions, that is the first thing to tune.
