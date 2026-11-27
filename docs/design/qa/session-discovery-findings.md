# Session frontend — discovery pass

Branch under test: `test/all-fixes` (all five fix lanes merged).
App: `/m` at `localhost:3000`, EE backend via traefik `:8081`.
Project: `mobile-test-project` `019fc6e9-0165-7a10-97e0-1438466474bf`.

Discovery only. Nothing fixed here. Severity is my read, not a decision.

| Sev | Meaning |
|---|---|
| S1 | Data loss, or a flow that cannot be completed |
| S2 | Wrong state the user must work around; likely the thing people complain about |
| S3 | Papercut, confusing copy, avoidable friction |
| N  | Note / question, not clearly a bug |

---

## Findings

<!-- appended as found -->
### F1 · WITHDRAWN · Sidebar "Sessions" group appeared permanently empty

Originally logged as "the nav Sessions group always says No sessions yet". It does populate.
Once the tab count was brought back down (see F4) the group listed sessions normally.

This was almost certainly a symptom of F4, not its own bug: with the connection pool exhausted
the nav's list query never resolved and the group fell back to its empty label. Same root cause
as F5 (a stalled query rendering as "nothing here").

Leaving it recorded rather than deleting it, because "the nav goes empty" is a real thing people
will report, and F4 is the thing to fix.

### F2 · S1 (local env) / N (product) · Every agent run fails: invoke URL has no port

Sending any message produces `The agent run failed / Failed to fetch`. The real cause:

```
POST http://localhost/services/agent/v0/invoke      <- no port, so port 80
blocked by CORS from origin http://localhost:3000
```

The URL comes from the workflow revision's stored `data.url`, which is
`http://localhost/services/agent/v0`. The deployment's env is correct today
(`AGENTA_SERVICES_URL=http://localhost:8081/services` in both the api container and
`.env.ee.dev`), so the portless URL was baked into the revision when the agent was created
and never revisited.

Two separate things worth splitting:

- Locally this blocks 100% of agent runs, which is why nobody can test run-dependent flows.
- As product behaviour: the service URL is frozen into each revision at creation. If a
  deployment's services URL ever changes (port, host, scheme), every pre-existing agent
  keeps calling the old one. Worth confirming whether that is intended.

### F2b · local dev only · Without the OTLP host-alias fix, no new session can be created locally

Discovered by accident while re-verifying F11. **Scoped to the local dev stack** (Arda, 2026-09-01):
`isAgentaIngest` only misjudges the deployment's own ingest when that ingest is reached through a
LOCAL host alias, which is a dev-stack shape. A real deployment's OTLP endpoint is a normal host and
matches correctly, so this is not a production severity and PR #6392 needs no re-framing. Recorded
here because it silently blocks local session QA and the symptom points nowhere near tracing.

The runner's credential for calling the Agenta API is not an env var. It is lifted from the OTLP
export headers:

```ts
// services/runner/src/engines/sandbox_agent/runtime-policy.ts
export function runCredential(request: AgentRunRequest): string {
  const headers = request.telemetry?.exporters?.otlp?.headers ?? {}
  return (headers["authorization"] ?? headers["Authorization"] ?? "").trim()
}
```

`isAgentaIngest` decides whether that credential is attached at all. So when it wrongly judges the
deployment's own ingest to be a third-party collector, the runner is left with NO API credential
and every authenticated call fails:

```
[sessions/records-query] query FAILED session=…: HTTP 401
[sessions/persist] DROPPED … after 6 retries: HTTP 401
[sessions/alive] heartbeat HTTP 401
```

What the user sees is not a tracing problem. It is:

> Agent run failed: session … record log is unreadable; cannot rebuild the conversation

and the session is never persisted, so **new sessions cannot be created**. The runner is behaving
correctly when it fails that turn — `reconstruct-history.ts` deliberately refuses to answer with an
empty context rather than produce an agent that silently forgot everything.

Reproduced by simply checking out a branch without the fix (the runner bind-mounts `src`), and
resolved immediately by restoring it: same project, same agent, run completes in 15.21s with no
401s.

For anyone doing local session QA: if runs die with "record log is unreadable", check that the
branch carries the `LOCAL_HOST_ALIASES` fix before looking anywhere else. The `test/all-fixes`
branch has it.

### F3 · FIXED (#6427, #6428) · A failed run shows a raw browser error, and the visible banner blames the wrong thing

The in-thread failure reads `The agent run failed` / `Failed to fetch`. That is the raw
`TypeError` from `useAgentConversation`, surfaced verbatim. Meanwhile the banner directly
below it says `Add your model provider key to run this agent`, which is a different cause
and, in this case, not the one that failed.

So the user is told two things, one meaningless and one wrong. There is also no retry on the
failed turn. The message text is kept, which is good.

### F4 · LARGELY WITHDRAWN · Connection exhaustion was my automation, not tab count

**WITHDRAWN 2026-09-01 (measurement artifact).** Both watch implementations are FOREGROUND-ONLY
and close on `visibilitychange -> hidden` — oss via the shared `useWatchEventSource`, `/m` via its
own copy in `useSessionWatch.ts`. A real browser marks a background tab hidden, so a user with six
tabs holds streams in ONE of them.

My measurement was taken in a CDP-driven browser where every tab reports `visibilityState:
"visible"`, including background ones (verified across six tabs). Nothing ever went hidden, so
every tab held both streams at once. That is what exhausted the pool — the automation, not the
product.

What survives, much reduced: two visible WINDOWS side by side are genuinely both visible, so
2 windows x 2 streams = 4 connections against a ~6 ceiling on HTTP/1.1. Three side-by-side windows
on a plain-HTTP self-hosted deployment could still hit the wall. Not S1, not "4 tabs", and not
reachable by ordinary tabbed use.

Lesson, the same one as [F18]: verify that the measuring instrument is not the cause. Two of the
three S1 findings in this document were my own tooling.

This is the most likely source of "sessions are broken" complaints, and it explains why nobody
could write it down: it depends on how many tabs you have open, not on what you clicked.

Every session page holds TWO long-lived SSE connections to the API origin:

```
GET /api/sessions/watch?project_id=…
GET /api/sessions/streams/watch?session_id=…&project_id=…
```

Locally the API is served over plain HTTP through traefik on `:8081`, which negotiates
**HTTP/1.1** (`curl -w %{http_version}` -> `1.1`). Browsers allow ~6 connections per origin.
Three session tabs consume all six, and everything after that queues forever.

Measured, opening the same session in successive tabs and then loading the sessions list:

| session tabs open | sessions list |
|---|---|
| 1 | project resolves, 3 rows |
| 2 | project resolves, 3 rows |
| 3 | project resolves, 3 rows |
| 4 | **0 rows** |
| 6 | project chip degrades to "Select project", 0 rows everywhere, page JS stalls |

Closing back down to one tab recovers immediately, with no reload.

At six tabs the whole app is unusable: the agents page shows nothing, the project switcher
says "Select project", and `querySessionMounts` / `querySessionStreams` / `queryInteractions` /
`querySessionRecords` all log `failed: "timeout"` while the API itself answers `/api/health`
in 5-40ms. The timeouts are client-side queueing, not backend slowness.

Production negotiates **HTTP/2** (`cloud.agenta.ai` -> `2`), which multiplexes, so the ceiling
there is much higher. That makes this mainly a local-development and plain-HTTP self-hosted
problem. It is still worth taking seriously:

- The team develops locally, which is exactly where it bites.
- Two persistent streams per tab is a lot regardless of protocol.
- A self-hosted install behind plain HTTP hits the same wall.

### F5 · FIXED (#6430) · A stalled request renders as "No sessions yet", which is a lie

While F4 has the connection pool exhausted, the sessions list does not show a loading state or
an error. It shows the empty state:

> No sessions yet. Start a conversation with an agent and it will show up here.

on a project with 43 sessions, with nothing anywhere on screen indicating a problem
(`anyErrorShown: false`).

This is worse than the stall itself. A user who sees it reasonably concludes their sessions
were deleted. Any request that has not resolved should hold the skeleton or fail visibly
rather than resolve to "you have nothing".

### F6 · FIXED (#6429) · On a phone, session rows lose their title — every session with the same agent looks identical

The sessions list row renders the session name at **zero width** on every common phone size, so
the row shows only the agent name and a timestamp:

> Test agent · 7m ago
> Test agent · 9m ago

Those two rows are "sup?" and "hi hi". The names are in the DOM at the right position
(x=54, height 20, `display:block`, `visibility:visible`, `opacity:1`) with `width: 0`. It is a
layout collapse, not a hide.

Measured across widths, on the same list:

| viewport | session name width | Session-actions button right edge | clipped by viewport |
|---|---|---|---|
| 360 | 0 | 396 | yes |
| 390 | 0 | 396 | yes |
| 414 | 0 | 396 | no |
| 430 | 10 | 406 | no |
| 500 | 80 | 476 | no |
| 768 | 348 | 744 | no |

Two symptoms, one cause: the row's fixed content (icon, agent name, timestamp, pin, kebab) is
wider than a phone, so the flexible title absorbs the whole deficit down to 0 and the kebab is
pushed past the right edge.

Practical impact, and this is the part worth caring about: on a phone you cannot tell your
sessions apart. The one thing a session list exists to do. Anyone with several sessions against
the same agent sees an undifferentiated list of "Test agent".

Affected widths cover essentially every phone in use: iPhone SE 375, iPhone 14/15 390,
Pro Max 430, most Android 360-412. The title only becomes readable around 500px.

### F7 · FIXED (#6429, same change as F6 — kebab right edge 396 -> 366 at 390px) · The session-actions kebab is off-screen at 360 and 390 px

Same root cause as F6, but worth its own line because it removes function rather than
information. The `Session actions` button sits at x=372 with width 24, so its right edge is 396
against a 390 (or 360) viewport. The page does not scroll horizontally
(`documentElement.scrollWidth === innerWidth`), so the control cannot be reached at all.

Rename, pin, archive and delete are behind that kebab. On the two most common phone widths they
are unreachable from the sessions list.

### F8 · FIXED (#6434) · The composer advertises keyboard shortcuts to phone users

At 390px the composer placeholder still reads:

> Ask the agent… (Enter to send, ⌘/Ctrl+Enter for newline)

and the footer renders `↵ Send` and `⌘ ↵ Newline` chips. On a touch keyboard none of that is
actionable, and it consumes width that is already scarce. `isMacPlatform()` keys off the UA, so
a real iPhone gets the `⌘` variant specifically.

### F9 · WITHDRAWN · Session search works correctly. This was my measurement racing a debounce.

Root-caused by instrumenting `useSessionsList` itself. The finding was wrong three times over and
the search has no defect.

`SessionSearchControl` holds a local `draft` and applies it to the filter atom through a
**300ms `setTimeout`** (`SEARCH_DEBOUNCE_MS`), so that every keystroke does not refetch two lists.
Nothing is requested during that window.

`browse wait --networkidle` returns as soon as the network is quiet — and during the debounce
window it IS quiet, because no request has been made yet. So a chain of "settle" calls could
total well under 300ms and I read the list before the filter had been applied at all.

The probe made it unambiguous. Same page, same typing, only the wait differs:

```
immediately after typing "zzzz" :  hookSearch=""      groupRows=13
after a real 2s wait            :  hookSearch="zzzz"  groupRows=0
```

With real timed waits, every query is exactly right:

```
morning -> 1     test -> 3     hi -> 2     zzzz -> 0
```

which matches a case-insensitive substring match over the 13 names, and matches what the API
returns for the same predicates.

Three separate errors produced this finding, all mine:

1. Reading during the 300ms debounce, so the filter had not been applied yet.
2. Judging "history of bread" matching `hi` as contamination. It is a correct substring match.
3. Assigning `input.value` programmatically, which does not reliably reach React's `onChange`,
   so some trials never applied a filter while the box visibly showed the text.

Lesson worth keeping: `--networkidle` is not a settle signal for anything gated behind a timer.
Wait on the state you actually care about, or on real elapsed time.

### F10 · NOT REPRODUCIBLE, evidence corrected · Composer keystroke loss

**2026-09-01 — the stated evidence was a misreading, and the symptom does not reproduce.**

The "two open `role=menu` popovers" are not popovers. They are the sidebar navigation and its
footer, which carry `role="menu"` permanently:

```
[role=menu] #1  255x484  "Home Agents Open to load Sessions QA file-persistence test ..."
[role=menu] #2  255x68   "Settings Help & Docs v0.114.3"
```

Both are present on every page at all times, so they say nothing about focus being stolen. I read
a static landmark as a transient popover.

Seven repro attempts, none lost a character or focus:

- the original string `CROSSTAB-PROBE-alpha`, typed into the same surface
- typed ACROSS a forced re-render (an out-of-band archive firing the project watch mid-typing,
  to test whether a remount drops the tail)
- five rapid consecutive attempts

Every one ended with the full text and `activeElement` still the editor.

The original observation may still have been real — the loss began exactly at the second hyphen,
which would fit a remount seeded from a stale draft — but there is no evidence for it beyond one
unrepeatable sighting, and the reasoning that supported it was wrong. Left recorded rather than
raised: if anyone sees partial composer loss again, capture `activeElement` and whether the
editor remounted, not the menu count.

Seen once, not reliably reproduced, so recording rather than asserting.

While typing `CROSSTAB-PROBE-alpha` into the session composer, the composer ended up holding
only `CROSSTAB-PROBE`, Enter did not send, and the DOM showed **two open `role=menu` popovers**
with `document.activeElement === BODY`. The trailing characters went nowhere.

Worth someone trying to reproduce by typing quickly, or typing text containing `-`, and
watching whether a menu opens and takes focus mid-keystroke. If it reproduces it is an S2:
silent partial message loss in the composer.

### F11 · FIXED (#6426) · A session started in another tab does not reach the list until reload

Re-verified after F9 turned out to be a measurement artifact, this time with REAL elapsed waits
(`setTimeout` promises, not `--networkidle`, which returns instantly when nothing is in flight).

Two tabs. One holds the sessions list; the other opens a new session and sends a first message,
which is what makes the session real server-side. Then the list tab is polled four times at 8
second intervals, untouched, and only afterwards reloaded:

```
after 32s of real waiting :  main-list rows 14,  new session absent
after reload              :  main-list rows 15,  new session present
```

The row count is the reliable signal here; it moves only on the reload.

Refinement worth having: during those same 32 seconds the session name WAS already on the page,
in the left nav. So the nav group is updating live from the watch stream while the main list is
not. The transport exists and is delivering; the list query is what does not react to it.

That asymmetry is the lead for whoever fixes this: compare what the nav's sessions source does
with the event to what `useSessionsList` does with it.

Note on the first attempt at this re-verification: it initially looked like the session was not
being created at all. That was a real environment failure, unrelated to this finding, and it is
worth reading — see the note under F2 about the runner's credential riding the OTLP headers.

**ROOT-CAUSED AND FIXED** (branch `fix/session-watch-list-events`, commit `987214bccc`).

`session-changed` on the project watch channel is the only signal an open session list gets, and
it was published from exactly ONE place: `set_header`, the rename path. Creating a session,
archiving, unarchiving and deleting were all silent, so a list only ever learned about renames.
Creation was the visible one: `_start_turn` and the runner's first `heartbeat` publish `lifecycle`
instead, and that rides the per-session channel, which no list subscribes to.

The nav looked live only because it POLLS (`refetchInterval: livePollInterval` -> 15s while
anything is alive). The list has `staleTime: 30_000` and no interval, so the watch is its only
signal. That asymmetry is why the same page showed the session in one pane and not the other.

The fix publishes `session-changed` from every transition that changes which rows a list shows:
row created, re-nested from a killed tombstone, un-hidden from archived, archived, hard-deleted.
Each is once per session. `lifecycle` deliberately stays off the project channel: it fires twice
per TURN, and a project-wide invalidation at that rate would refetch every open list on every turn
boundary.

Verified live on the EE dev stack, list tab visible throughout, no reload at any point, with an
independent `EventSource` tapping the watch stream:

```
archive   (out-of-band)  15 -> 14 rows, top row changed      session-changed frame captured
unarchive (out-of-band)  14 -> 15 rows, top row restored     session-changed frame captured
create    (out-of-band)  15 -> 16 rows, NEW ROW AT TOP       session-changed frame captured
delete    (out-of-band)  16 -> 15 rows, baseline restored    (cleanup)
```

Every mutation was issued by `fetch` from the page, so the app's own React state had no knowledge
of it. The list could only have refetched via the relay.

10 new unit tests in `api/oss/tests/pytest/unit/sessions/test_watch_session_list_publish.py`,
including the negative cases (further turns on a live session must NOT republish; an archive that
matched nothing must not publish). Full sessions suite green: 484 passed, 41 skipped.


### F12 · POSITIVE · Messages inside an open session DO sync across tabs

Recording the negative result so nobody re-investigates it.

Two tabs on the SAME session, sent a message in one. The other tab showed it on the first read
afterwards, with no reload and no user action. It survived a reload too.

So live sync works at the message level within a session. It is the session LIST that is stale
(F11). Worth keeping those two apart when triaging reports, because "sessions don't update"
will be said about both.


### F13 · S2 · A runner restart orphans every existing session

After recreating the runner container, sending in an existing session fails with a raw internal
error:

> Agent run failed: local sandbox requires a single runner: replica
> 'b0c31486-4a1a-4e04-b8c7-6d6ee44d7559' is not the owner of session '5d0f1186-…'
> (owned by 'e43a0de9-…')

Sessions are pinned to the runner replica that created them. When that replica goes away the
session cannot be resumed at all, and the user is shown replica UUIDs.

New sessions bind to the live replica and work fine, so the workaround is "start a new session",
which the error does not say.

Worth checking what this does in production with more than one runner replica: if a session can
only ever be served by the replica that created it, a deploy or an autoscale event strands every
in-flight session the same way.

### F14 · S3 · 25 seconds of "Starting the agent" with no detail

A first turn in a new session spends a long time before anything appears. Runner timings for a
trivial prompt:

```
stage=sandbox_start      ms=563
stage=prepare_workspace  ms=719
stage=probe_capabilities ms=1361
stage=create_session     ms=19175      <- the bulk
stage=acquire_total      ms=24468
```

The whole 24.5s the UI shows one static line, `Starting the agent`. A trivial "count to 12"
turn took 37.65s end to end, most of it this.

The runner knows exactly which stage it is in and how long each took. None of that reaches the
user. A progress line naming the stage would turn a seemingly-hung screen into an obviously
working one, without making it faster.

### F15 · BY DESIGN (copy owed) · The build-an-agent skill launches on every message

**2026-09-01 — intended behaviour, not a defect.** The skill is NOT forced
(`AGENTA_FORCED_SKILLS` holds only `agenta-getting-started`). It fires because its own
description tells the model to:

> "ALWAYS read this skill at the start of the conversation, before your first reply, to load
> context on what you are and how you configure yourself."

`docs/design/agent-workflows/projects/agent-templates/research.md` names that clause the
**primary surfacing** of three deliberate "read-first" nudges. Removing it would delete a
documented mechanism, so it is not something to change from a symptom.

The gap is that "at the start of the conversation" cannot hold: a model re-reads descriptions
every turn with no memory of having complied, so ALWAYS reads as ALWAYS. Fixing that properly
means surfacing the clause only on turn 0, and `force_skills()` is a pure list union with no run
or turn context — the description lives on `SkillTemplate`, a stored config shape — so turn
awareness would have to be plumbed through skill composition across the SDK boundary.

The same design doc records that this copy is unfinished ("the preamble and persona are still
`TODO(product)` placeholders; the mechanism is live but the copy is owed"), so the wording is
already someone's open item. Cost as measured: one skill launch plus its tokens on every turn,
including turns where the agent then says out loud that it is not an agent-building task.

For the owner to decide, not to infer:

1. Drop the ALWAYS clause and rely on the forced `agenta-getting-started` for identity context.
2. Plumb turn awareness so the clause is surfaced only before the first reply.
3. Accept the per-turn cost.

Every turn opens with `Skill: Launching skill: build-an-agent`, including for "count from 1 to
12" and "tell me one fact about bees". On one of them the agent itself said so in its reply:

> This isn't an agent-building task, just a quick counting request — no config changes needed.

So the user sees a skill fire, and the model spends tokens deciding to ignore it, on every
single message. It is noise in the transcript and latency in the turn.

### F16 · POSITIVE · A reload mid-run recovers the turn

Sent a message and reloaded immediately, inside the acquisition window. The turn survived: after
the page settled, both the prompt and the completed reply were there.

One rough edge: in the seconds right after the reload the page shows nothing at all — no prompt,
no "resuming", no running indicator. A user reloading a slow turn sees an empty conversation
before it comes back, which looks like the message was lost.

### F17 · N · A non-UUID session id renders a working session that never live-updates

Not a user-facing path (the app mints UUIDs via `newId()`), so recording it only because it cost
me a false finding and might cost someone else one.

Opening `/sessions/<not-a-uuid>` renders a normal session. Messages send, run, persist and are
there after a reload. But live updates never arrive in that tab. With a valid UUID in the same
scenario, a second tab sees the new turn on the first poll.

If a hand-written or truncated session link is ever reachable, it fails silently rather than
refusing.

---

## Summary

Seventeen entries: 12 issues, 2 withdrawn, 2 positive results, 1 note.

| # | Sev | What |
|---|---|---|
| F1 | withdrawn | Sidebar "No sessions yet" — was a symptom of F4 |
| F2 | S1 local / N product | Agent invoke URL has no port; blocks every local run. Service URL is frozen into each revision |
| F3 | S2 | Failed run shows raw "Failed to fetch"; the visible banner blames the wrong cause; no retry |
| F4 | S1 local / S2 self-hosted | App stops loading at 4+ session tabs (2 SSE per tab vs HTTP/1.1's 6) |
| F5 | S2 | A stalled request renders as "No sessions yet" on a project with 43 sessions |
| F6 | S2 | Phone: session title collapses to 0px, so every session with one agent looks identical |
| F7 | S2 | Phone: the session-actions kebab is off-screen at 360 and 390 px |
| F8 | S3 | Phone: composer advertises Enter / ⌘-Enter keyboard shortcuts |
| F9 | withdrawn | Search is correct; the finding was my measurement racing a 300ms debounce |
| F10 | N | Composer once lost focus mid-typing and swallowed characters; not reproduced |
| F11 | S2 | CONFIRMED: a session started in another tab needs a reload (nav updates live, list does not) |
| F12 | positive | Messages inside an open session DO sync across tabs |
| F13 | S2 | A runner restart orphans every existing session with a replica-ownership error |
| F14 | S3 | ~25s of "Starting the agent" with no stage detail, though the runner has it |
| F15 | S3 | build-an-agent skill fires on every message, including irrelevant ones |
| F16 | positive | A reload mid-run recovers the turn (but shows an empty screen first) |
| F17 | N | A non-UUID session id renders a working session that silently never live-updates |


### If only three get fixed

**F4** first. It is the one that makes people say "sessions are broken" without being able to say
how, because the trigger is tab count rather than anything they clicked. It also manufactures F5
and the withdrawn F1, so fixing it removes three reports.

**F6 + F7** next. Together they mean the mobile session list cannot be read or acted on. Both are
one layout problem in the row, and both are fixed on `fix/session-row-narrow`.

**F13**, because a runner restart stranding every existing session with a replica-UUID error is
the kind of thing that looks like data loss and will recur on every deploy.

### What I could not cover

- **Stop mid-run.** The Stop control appears and works (it disappears on click), but this agent's
  AGENTS.md forces one-or-two-sentence replies, so no turn ran long enough to interrupt for real.
  Testing it properly needs an agent whose instructions permit a long answer.
- **Approvals / HITL.** The runner logs `[HITL] approval extract envelopes=0`, so the path is
  live, but this agent has no tools and never raised a gate. Needs an agent with a tool whose
  permission is `ask`.
- **Steer** (sending while a turn runs) for the same reason as Stop.
- **A real mobile user agent.** Headed browse cannot change UA without recreating the context,
  which would have closed the operator's own tabs. The app reads UA only for the ⌘-vs-Ctrl glyph
  and keys all responsive behaviour off viewport, so 390px testing is faithful except for F8's
  exact glyph.

### Test-data changes I made

- `Test agent` in `mobile-test-project` is now at **v5**. v3 and v4 were mine: v3 clobbered the
  agent's instructions (I wrote a string over the `{agents_md: …}` object) and v4 repointed the
  service URL to `:8081` so runs could be tested at all. **v5 restores v2's instructions** and
  keeps the working URL. Net effect versus where it started: the service URL now has a port.
- Several probe sessions exist: `NEWSESS-PROBE…`, `LIVELIST-PROBE…`, `REGIONTEST-PROBE`, plus
  failed-run turns in `hi hi`.
- `tracing-6` and `tracing-7` each gained a "New agent" from earlier PR testing.
- `Test agent` also moved to the **Claude Code harness on a self-managed (subscription) credential**
  so runs could be tested without API spend: `harness={kind:"claude"}`, `llm={provider:"anthropic",
  model:"sonnet", connection:{mode:"self_managed"}}`. That needs
  `hosting/docker-compose/ee/docker-compose.dev.harness.local.yml` (gitignored) mounting
  `~/.agenta-claude-config` at `CLAUDE_CONFIG_DIR`. Revert by setting `harness.kind` back to
  `pi_core` and dropping the `connection` block.
- Probe sessions from the run tests: several UUID-named ones plus `qa-*` ids.

### F18 · WITHDRAWN · A runner authenticated by OAuth token is reported as having no subscription

**WITHDRAWN 2026-09-01.** Self-inflicted. The only thing that put the runner in this state was a
gitignored compose override written during this session to mount a personal Claude login; the
`CLAUDE_CODE_OAUTH_TOKEN` fallback it describes is that same file's comment, not a repo convention.
No deployment is known to be configured this way and no user reported it. PR #6425 closed.

The underlying mechanic is still true and worth knowing — `CLAUDE_CODE_OAUTH_TOKEN` IS in the
`anthropic` group of `PROVIDER_ENV_VAR_GROUPS`, so a run does inherit it — but whether
`subscription-status` should report `ready` on it is a product decision, not a bug.

Kept as a lesson: a "finding" whose trigger was created by the investigator is not a finding.

The Claude subscription probe decides `ready` vs `login_missing` by stat-ing ONE file:

```ts
// services/runner/src/subscription-status.ts
claude: { dirEnv: "CLAUDE_CONFIG_DIR", file: ".credentials.json", provider: "anthropic" },
```

But the file is not the only way the harness authenticates. `CLAUDE_CODE_OAUTH_TOKEN` is in the
`anthropic` provider env group, so a run inherits it and the harness uses it:

```ts
// services/runner/src/engines/sandbox_agent/daemon.ts
anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN", ...],
```

The EE dev compose override documents that env var as the supported fallback ("covers an expired
session, regenerate with `claude setup-token`"). Configure it WITHOUT mounting a credentials file
and the deployment can run, while the probe says it cannot.

Observed live, 2026-09-01, EE dev:

```
runner container : CLAUDE_CODE_OAUTH_TOKEN SET (108 chars), no /claude-config/.credentials.json
POST /services/agent/v0/runtime/subscription-status -> 200
   {"runner":"connected","harnesses":{"claude":{"state":"login_missing","provider":"anthropic"}}}
/m session page  : composer contenteditable=false, strip reads
                   "Add your model provider key to run this agent."
```

Two defects, one cause:

1. **The probe is incomplete.** It should report `ready` when the harness has a usable credential by
   ANY of the routes the run itself will use, not only the file route.
2. **The remedy named is wrong.** Even granting a genuinely absent subscription, the runner said
   `login_missing` for a `self_managed` Claude agent, and the UI answered "add your model provider
   key" — a key this agent does not use. The state that would tell the user what to actually fix is
   already on the wire and the strip ignores it.

Blocks all local session QA on a subscription-only project: with no vault key and no subscription
pair, there are zero candidates, so the composer is disabled and no run can be started at all.

### F19 · FIXED (#6424, root cause is F20) · The model-candidates state can sit in `loading` forever, and the composer stays disabled

Found while trying to verify F18's fix in the browser. Not root-caused; recorded with the
evidence so the next person does not start from zero.

`agentModelCandidatesAtomFamily(true)` never leaves `status: "loading"` on the `/m` session page,
across reloads and after clearing IndexedDB. A probe inside `useAgentModelKeyStatus` read the same
value on every render for 24s+:

```
{status:"loading", candidates:0, connections:0, capabilityKeys:[], error:null, gateActive:false}
```

`connections: 0` is computed BEFORE the early return, so `vaultRows` is empty or undefined, and
`capabilities` is null. Yet the underlying request succeeds:

```
GET /api/workflows/catalog/harnesses/ -> 200 (22538B)
```

So the network answered and the atom did not adopt it. That is the signature of the query-client
host divergence class ([[project-query-client-host-divergence]]), though `/m` was supposedly fixed
for that in #5915 — worth re-checking rather than assuming.

Two consequences, and the second is the one that misleads:

1. `status !== "ready"` makes `connectModelGate` return **false**, so the gate is NOT what disables
   the composer here. `disabled={conversation.isHydrating || modelBlocked}` — it is `isHydrating`.
2. The `ConnectModelStrip` text is still present in `document.body.innerText` while `RevealCollapse`
   holds it collapsed, so a text search "sees" the connect-a-model banner when nothing is shown.
   Any DOM assertion about that strip has to check an actual box, not text.

Also observed alongside, unexplained:

```
[queryInteractions] failed: "timeout"
TypeError: Cannot read properties of undefined (reading 'components')   (recurs on every HMR)
```

Blocks browser QA of anything that needs to send a message on `/m`.

### F20 · FIXED (#6424) · A hung IndexedDB open freezes every persisted query forever, with no error

**Root cause of F19** (which described the symptom). Confirmed live, 2026-09-01.

`idbQueryStorage.getItem` runs INSIDE each query's `persisterFn`, ahead of the real `queryFn`. It
calls `idb-keyval`'s `get`, which first opens `agenta-query-cache`. When that open never settles,
the read never settles, so the query never fetches: `enabled: true`, no request, no error,
`isPending: true` forever. Every consumer then holds its loading state permanently.

The `try/catch` around it is powerless — a promise that never rejects cannot be caught.

Proof, from the browser with the bug live:

```js
const r = indexedDB.open('agenta-query-cache')
r.onsuccess  = () => console.log('IDB OK')       // never fired
r.onblocked  = () => console.log('IDB BLOCKED')  // never fired
setTimeout(() => console.log(r.readyState), 3000) // -> "pending"
```

The split it produces is exactly what we saw, and what made it read as three unrelated bugs:

| query | persister | behaviour |
|---|---|---|
| workflow revision | `immutablePersister` | stuck pending — agent config skeleton forever |
| vault secrets | yes | **no request ever fired** |
| harness catalog | `catalogPersister` | stuck `loading` |
| agents list, sessions list | none | worked normally throughout |

Fix: cap the read (`withReadTimeout`, 3s) and fall through to `undefined`, which is a cache miss —
the same degradation this adapter already applies to every other storage failure. The cap is the
only possible remedy, since the failure mode is a promise that neither resolves nor rejects.

Diagnostic note for the next person: the molecule reduces the query to
`{data, isPending, isError, error}` and DROPS `fetchStatus`, so "disabled" and "hanging" look
identical from `PlaygroundConfigSection`. Probe `enabled` at the query atom instead. `enabled: true`
with no fetch log is the signature of a stalled persister.
