# speed-budgets: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **First-load size**: the gzip size of the JavaScript that a route needs before it shows (the app shell plus the route chunks). Chunks loaded with `next/dynamic` do not count. `speed:check` measures it.
- **Session switch**: a click on a session in the sidebar that opens another session.
- **Warm switch**: a switch to a session that was opened before in the same page, so its messages are in the browser cache.
- **Cold switch**: a switch after the browser caches of sessions were cleared (the `localStorage` keys `agenta:agent-chat:messages:v2` and `agenta:agent-chat:record-counts:v2`, the open-tabs keys and the IndexedDB `agenta-query-cache`) and the page was reloaded.
- **Click to done**: the time from the click to the later of two moments: the paint of the last turn of the target conversation, and the end of the last long task (a task over 50 ms). The spec then waits 300 ms with no long task to confirm the end; that wait is not counted.
- **Switch timing spec**: a Playwright spec that clicks a sidebar session row and records click to URL, click to done, long tasks and the API requests. Its method is in the section "The switch timing spec" below.
- **Re-render**: React runs a component function again. A **commit** is React writing the result to the page.
- **Remount**: React removes a component and creates a new one, so its state is lost.
- **Page role**: whether a conversation is the main conversation of the page (`page`) or a conversation in a side place such as the builder panel (`embedded`).
- **Median of N**: the middle value of N runs.

## Measured numbers (19 November 2026, prototype, production build with React profiling, served by `next start`, Chrome at 1440 x 900, no throttling, sessions of 2 turns)

"Old" is the production session layout. "Prototype" is the prototype of the builder layout.

| Case | Layout | Runs | Click to done, median [range] ms | Click to URL ms |
|---|---|---|---|---|
| Same agent, warm | old | 5 | 377 [370-663] | 252 |
| Same agent, warm | prototype | 5 | 339 [338-360] | 257 |
| Same agent, cold | old | 7 | 901 [750-1151] | 250 |
| Same agent, cold | prototype | 5 | 747 [598-1559] | 250 |
| Other agent, warm | old | 5 | 383 [347-595] | 252 |
| Other agent, warm | prototype | 5 | 331 [319-333] | 253 |
| Hover 300 ms, cold | old | 1 | 865 | 250 |

Limits of these numbers: the probe read the last turn of the whole page, not of the target conversation. With the builder panel open, it could read the builder's last turn, so the prototype rows may be wrong. The ranges are wide (598 to 1559 ms for one case), and five runs do not show the spread. Treat every median as a diagnostic until task 55.2 measures the spread. Duplicate counts by path alone may count different requests as one.

Status: the budget numbers (50, 160 and 560 ms) are PROPOSED. Mahmoud has not confirmed them. How the budgets follow from the numbers: removing the 220 ms hold takes the warm medians to about 120 ms and the cold median to about 530 ms. The budgets add about 30 ms of margin.

The three biggest costs measured: the 220 ms hold (58 to 67 percent of a warm switch); on a cold switch `records/query` starts late (about 450 ms after the click) and the transcript paints about 300 ms after the response; React render and commit work of 55 to 85 ms warm and 120 to 160 ms cold, spread over many components.

Not measured: per-component React times, long sessions, real internet latency, and whether the agent revision chain gates the conversation mount (one trace suggests it).

## The switch timing spec

Task 55.1 of the speed project adds it to the repo as `web/tests/visual/switch.spec.ts`, with the existing `@playwright/test` of `web/tests`, so every measurement uses one method. It runs on demand against a production build, never in CI. Comparisons run against the production stack.

Method:
- Click the sidebar link with `element.click()`.
- Record the URL change.
- Find the target conversation by its session id (the page conversation root) and wait for the paint of a known text of its last turn. Never select the last turn of the whole page: the builder panel has its own conversation. The old probe used `document.querySelectorAll(".ag-turn")` and took the last match.
- Wait one frame, then wait until no long task runs for 300 ms. Click to done ends at the later of the paint and the last long task end; the quiet wait is not counted (as the old probe computed it).
- Cold runs: clear the cache keys named above, reload, wait 6 s, then click.
- Record long tasks, long animation frames and every API request with its method, project and payload. Two requests are duplicates only when method, project and payload match.
- Run each case at least five times. Report the median and the range. A median is a diagnostic until task 55.2 knows the spread.

## Today's behavior (origin/main 5d783fec, v0.129.0)

- `speed:check` is `node scripts/speed/check.mjs` (`web/mobile/package.json:22`). The margin is 3 percent or 5,120 bytes (`web/mobile/scripts/speed/budget.json:2-6`, `check.mjs:72-75`). Budgets: `/agents/[agent_id]` 1,869,151 bytes, `/sessions/[session_id]` 1,753,251 bytes, `/sessions` 1,817,331 bytes (`budget.json:22`, `:46-47`). Rules: `web/mobile/AGENTS.md:107-128`. CI runs it in `.github/workflows/17-check-mobile.yml:228-240`.
- The 220 ms hold: `web/packages/agenta-sessions-ui/src/SessionRowActions.tsx:196-219`.
- The transcript read follows every page until the end: `querySessionTranscript` loops over offsets with a page of 100 (`web/packages/agenta-entities/src/session/api/api.ts:105-150`). The backend already pages (`windowing` with `offset`, `limit` up to 200 and `through_sequence`).
- The browser keeps a record count per session (`web/packages/agenta-chat/src/state/sessionMessages.ts:68`, key `agenta:agent-chat:record-counts:v2`). Code that compares this count with the server assumes the whole log; a paged read would have to change it.
- The revision read is `POST /workflows/revisions/retrieve` (`web/packages/agenta-entities/src/workflow/api/api.ts:247`). Mobile keeps its own latest-revision query key (`web/mobile/src/features/chat/useAgentEntity.ts:45-46`), one likely source of the duplicate reads (not verified).

## Other places that mount the changed components

- `SessionRowActions` (the hold): the `/m` sidebar and the old desktop sidebar (`web/oss/src/components/Sidebar/dynamic/sessionRowWrapper.tsx:26`). `web/oss` is abandoned; it gets the change with no edit and must still compile.
- `querySessionTranscript`: every session open, the builder panel chat and the automation run conversation.

## Backend work

- None is needed for the budgets. The paged history read (a candidate of the speed project) would use the existing `windowing` of `POST /sessions/records/query`.

## Not drawn

- No screen. The loading states during a switch stay as production (skeleton rows, no spinner in the middle).

## Tasks

The speed project is section 55 of `tasks.md` (55.1 timing spec, 55.2 measure and fix the largest cost, 55.3 candidates). It is part of the release. The 220 ms hold goes in task 12.1. The builder panel render test is task 24.2.

## Candidates

The speed project of the release measures these first and fixes only what the numbers support (task 55.3). A candidate is work of the release when its measurement supports it; it is not a requirement before it is measured. Each comes with a before and after measurement.

- **History read in pages.** Opening a session reads only the last page of its records and loads older pages when the user scrolls up. Checks if adopted: a session with 1,000 records sends one `POST /sessions/records/query` with a window at the end of the log before the first paint; scrolling to the top loads the next older page and keeps the scroll position on the same message.
- **Keep the last conversations mounted.** The session screen keeps the last few conversations the user left (3 in the earlier proposal) mounted and hidden. A hidden conversation does not commit to the page while it streams. Proposed check: a return takes at most 100 ms click to done with no records read before the paint; the oldest kept conversation unmounts when the user leaves one more. Memory and CPU cost of hidden streams is not measured.
- **Hover prefetch.** A pointer that stays 300 ms on a session row starts the read of that session's last page of records. Proposed check: a cold switch after a 300 ms hover takes at most 300 ms click to done (measured today: 865 ms, one run); a row the pointer left before 300 ms starts no read.
- **Duplicate requests on a cold switch.** A cold switch sends each of `POST /workflows/revisions/retrieve`, `POST /sessions/query` and `POST /sessions/interactions/query` at most once for the target, and at most 15 API requests in total (PROPOSED number). Measured with path-only counting: 19 to 21 requests, each of the three sent three times; a warm switch sent two or three identical revision reads. Count again by method, project and payload before acting.
- **Cancelled first read.** When the first `records/query` of a cold switch is cancelled, the second read starts at once (measured once: a new read started 1,365 ms later).
