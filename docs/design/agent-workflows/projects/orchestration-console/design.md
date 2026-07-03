# Design — the orchestration console

## One-paragraph summary

The console is a **file-backed protocol + a small CLI + a tiny web app**. The orchestrator
writes project state (tasks, decisions, feed messages) through the CLI into a per-project
directory of Markdown files with structured frontmatter, plus an append-only `feed.jsonl`. A
single-file Python web server reads those files and renders a dashboard — a project overview,
running tasks, pending decisions with full context, and a "what's new" feed — and writes the
user's answers back into the same files. The orchestrator reads queued answers at the start of
each turn. The design docs and PRs stay where they are; the console links to them.

## The five pieces

1. **The file protocol** — the on-disk schema everything reads and writes (below).
2. **The CLI** (`console`, a `uv` single-file script) — the action surface the agent calls.
3. **The web app** (a `uv` FastAPI single-file server) — reads the files, renders the
   dashboard, accepts feedback.
4. **The skill** (`orchestration-console`) — teaches the orchestrator when/how to use the CLI.
5. **Edits to `queue-implement-feature` / `implement-feature`** — call the CLI at hook points.

Pieces 4–5 are covered in `skill-integration.md`. This doc covers 1–3.

---

## 1. The file protocol

### Layout

One root directory holds all projects. Default:
`docs/design/agent-workflows/scratch/console/` (configurable via `CONSOLE_ROOT`). Keeping it in
the repo tree means git, grep, and PR review all work on it, and it survives cold resume.

```
console/
  backlog/
    <id>.md                # cross-project notes and future work, not tied to one project
  <project-id>/
    project.md              # overview: the problem, goal, status  (frontmatter + prose)
    feed.jsonl              # append-only event stream — the "what's new"
    threads/
      <thread-id>.md        # one conversation per topic: running Summary + Messages log
    tasks/
      <task-id>.md          # one per sub-agent / work unit (also has a Messages log)
    decisions/
      <decision-id>.md      # one per thing that needs a specific call from the user
    inbox/
      <ts>-<id>.md          # free-text notes the user submits from the UI, awaiting pickup
```

The **backlog** sits at the console root, outside any project, for notes and future work that
outlive or cut across projects. An item has a `kind` (`note` or `task`), a `status` (`open` \|
`doing` \| `done`), and links back to its source thread and to any design docs.

A **thread** is the raw unit of the "in between": a topic under discussion. Its body has a
`## Summary` (the current answer, agent-maintained) and a `## Messages` log both sides post into.
Both render as markdown in the UI, so they read best short: an answer up front, a few bullets,
not a dense paragraph. Frontmatter: `id` (identity), `title` (data), `status` (state — whose turn
it is: `investigating` \| `waiting` \| `resolved` \| `promoted` \| `archived`; `investigating` is
the agent's turn, `waiting` is the user's), `needs_reply` (state — true when the user posted and
the agent has not replied; drives the pending list), `promoted_to` (routing — the task id if
promoted), timestamps (metadata). Tasks carry the same `## Messages` log and `needs_reply` flag,
so the user can post to a task too. A **decision** is the specialized thread that needs one clear
call (options + rec + the `open → answered → locked` lifecycle). Threads promote into tasks via
`thread promote`, which copies the Summary across as the new task's Context.

Rationale for the split:

- **Documents** (`project.md`, `tasks/*`, `decisions/*`) hold rich, editable context. Markdown
  with YAML frontmatter: the frontmatter is the machine state, the body is the human prose.
  The UI reads frontmatter to build lists and badges; it renders the body for context.
- **The feed** (`feed.jsonl`) holds the time-ordered stream. One JSON object per line,
  append-only. This is what powers "what changed since I last looked" cheaply: the UI (and the
  agent) track a last-seen sequence number and show only newer lines. Prose documents answer
  *"what is the state"*; the feed answers *"what just happened"*. Keeping them separate is what
  makes both cheap.

### Field design (by semantic role)

Applying the `design-interfaces` lens — classify each field by what it *is*, not the feature it
serves — so the schema stays stable as the tool grows.

**`project.md` frontmatter**

| Field | Role | Notes |
|---|---|---|
| `id` | identity | kebab-case, matches the directory name |
| `title` | data | short human title |
| `goal` | data | one or two sentences: the problem we're solving |
| `status` | state | `active` \| `paused` \| `shipped` \| `archived` |
| `created`, `updated` | metadata | ISO-8601 UTC; `updated` bumped on any write |

Body: the "read cold" overview (like `00-overview.md`), free prose, links to design docs.

**`tasks/<id>.md` frontmatter**

| Field | Role | Notes |
|---|---|---|
| `id` | identity | |
| `title` | data | |
| `status` | state | `queued` \| `running` \| `blocked` \| `in-review` \| `done` \| `dropped` |
| `owner` | routing | which sub-agent / model, or `orchestrator` |
| `pr` | routing | URL or `#number`; the console links out, does not mirror the diff |
| `design_doc` | routing | repo path to the design doc, if any |
| `blocked_on` | routing | a `decision` id this task waits on (drives the "blocked" badge) |
| `created`, `updated` | metadata | |

Body: **Context / Explanations / History** — the same structure the thread files already use.

**`decisions/<id>.md` frontmatter**

| Field | Role | Notes |
|---|---|---|
| `id` | identity | |
| `title` | data | the question in one line |
| `status` | state | `open` → `answered` → `locked` (or `dropped`) |
| `task` | routing | the parent task id, if any |
| `pr` | routing | the PR/comment URL if the decision also lives on a diff |
| `recommendation` | data | the agent's "my rec" (shown prominently) |
| `answer` | data | the user's call; written by the UI or by the agent on the user's behalf |
| `answered_by` | provenance | `user` \| `orchestrator` |
| `raised`, `updated` | metadata | |

Body: **Context** (why this is a question, read cold) / **Options** (a, b, c with trade-offs) /
**Recommendation** / **Your decision** (the writeback target).

**`feed.jsonl` — one event per line**

| Field | Role | Notes |
|---|---|---|
| `seq` | metadata | monotonic per project; drives "unread since N" |
| `ts` | metadata | ISO-8601 UTC |
| `type` | protocol | `message` \| `task_added` \| `task_updated` \| `decision_raised` \| `decision_answered` \| `decision_locked` \| `pr_opened` \| `note` |
| `ref` | routing | `task:<id>` \| `decision:<id>` \| `null` for project-level |
| `by` | provenance | agent label, or `user` for UI-submitted notes/answers |
| `text` | data | the human-readable line |

Note the deliberate consistency with `design-interfaces`: `id` is identity, `status` is state,
`owner`/`pr`/`ref`/`task`/`blocked_on` are routing, `title`/`goal`/`text`/`recommendation`/
`answer` are data, `by`/`answered_by` are provenance, timestamps are metadata. No field mixes
roles. That's what lets the UI and the CLI share one parser and stay stable.

### The decision state machine (the core of "where is my feedback needed")

```
        agent raises                user answers            agent acts + records
 (none) ───────────► open ──────────────────────► answered ──────────────────────► locked
                       │                                                              ▲
                       └───────────────── agent drops / supersedes ──────────────────┘  (dropped)
```

- `open` — needs the user. Shown in the dashboard's "Needs you" lane. (README "Open decisions".)
- `answered` — user submitted a call in the UI; awaiting the orchestrator to act on it. Shown
  as "you answered, agent picking up".
- `locked` — orchestrator acted and recorded the outcome. (README "Decided (locked)".)

This is the honest model of the async loop: the UI can move `open → answered` on its own; only
the agent can move `answered → locked`, because locking means the work reflecting the decision
is under way.

---

## 2. The CLI — the action surface

A single `uv` script (`console`) with subcommands. "The API we don't care about" — the *actions*
are what matter. Every command edits the files above and appends the matching feed event.

```
# projects
console project new <id> --title "..." --goal "..."
console project set <id> --status active|paused|shipped|archived

# tasks (a sub-agent / work unit)
console task add  <id> --project P --title "..." [--owner ...] [--pr ...] [--design PATH]
console task set  <id> --project P [--status ...] [--owner ...] [--pr ...] [--blocked-on D]

# decisions (something that needs the user)
console decision add    <id> --project P --title "..." --rec "..." [--task T] [--pr URL]
console decision lock    <id> --project P --answer "..."     # answered -> locked, records outcome
console decision drop    <id> --project P --reason "..."

# feed (narration / status — the "send")
console message "..." --project P [--ref task:<id>|decision:<id>] [--by <label>]

# read-back (cheap state reload for the agent)
console status  --project P            # renders the whole board as text (overview+tasks+decisions)
console pending --project P            # ONLY what needs the agent: answered decisions + inbox notes
console feed    --project P [--since N] # feed lines since seq N
```

Design points:

- **`console pending` is the start-of-turn ritual.** It returns the user's `answered` decisions
  and any `inbox/` notes — everything the user did in the UI since the agent last looked — as a
  compact block the orchestrator consumes first. This is what turns "go to chat and re-explain"
  into "the agent already has my answers."
- **Bodies are authored, frontmatter is CLI-managed.** `task add` / `decision add` scaffold the
  file with the standard sections; the agent then edits the prose body directly (it's just a
  file). The CLI owns the frontmatter and the feed so the machine state stays valid. This keeps
  the rich-context authoring the folder does today, while making the state parseable.
- **Idempotent, append-only feed.** `seq` comes from an atomic counter (advisory lock on
  `feed.jsonl`), so concurrent sub-agent appends don't collide. No database.
- **Same code as the UI.** The CLI and the server import one small `console_store.py` module
  (parse frontmatter, append feed, read pending). One source of truth for the schema.

---

## 3. The web app — the dashboard

### What it shows

- **Home** — list of projects with a status chip and an unread-count badge (new feed events
  since your last visit, tracked per-browser).
- **Project view** — four regions:
  1. **Overview** — goal + status (from `project.md`), links to the design docs.
  2. **Needs you** — the `open` decisions, most urgent first. Each expands to its full Context /
     Options / Recommendation, with an inline **answer box** (writeback) and, if present, a link
     to the PR where the same decision lives. This is the "where my feedback is needed, with
     context" the user asked for.
  3. **Tasks / sub-agents** — the task list grouped by status (`running`, `blocked`,
     `in-review`, `done`). Each task shows owner, PR link, design-doc link, and its Context/
     History body on expand. This is "which sub-agents are running and what each is doing".
  4. **Feed** — the reverse-chronological stream, with everything above the last-seen marker
     highlighted as new. This is "what's new / the last things to take care of".
- A **free-text note box** at the project level → writes an `inbox/` note (for feedback that
  isn't tied to a specific decision).

### Writeback

- Answering a decision: POST → append to the decision's "Your decision" section, set
  `status: answered`, `answer`, `answered_by: user`, append a `decision_answered` feed event.
  The agent picks it up via `console pending` and later locks it.
- A free-text note: POST → write `inbox/<ts>-<id>.md`, append a `note` feed event `by: user`.

The UI never locks a decision and never edits task/agent state — writeback is limited to *user
intent* (answers, notes). The agent remains the only writer of work state. This keeps the state
machine honest.

### Tech choice

**FastAPI single-file server, Jinja + a little htmx, run via `uv run`.** Reasons:

- Simplest thing that is genuinely deployable: one file, no build step, no node_modules, binds
  any port, `0.0.0.0` for external access. Shares the Python `console_store.py` with the CLI.
- htmx gives live-ish updates (poll the feed endpoint every few seconds, swap the changed
  region) without a SPA build. Good enough for a personal dashboard; no React toolchain.
- Renders Markdown bodies to HTML server-side (`markdown-it-py`), so the rich context shows
  formatted, with working links to design docs and PRs.

Rejected alternatives: a Next.js app in `web/` (needs the monorepo build, overkill, not
"simple/deployable" standalone); a pure static site (can't do writeback); a Slack/Linear
integration (adds an external dependency and doesn't own the file protocol). If a richer UI is
ever wanted, the file protocol + JSON endpoints are the stable contract, so the frontend can be
swapped without touching the agent side.

### Deployment / external access

- Run: `uv run console-web --root docs/design/agent-workflows/scratch/console --port 8799`.
- External reach: the same pattern already used for the dev box — bind `0.0.0.0`, put it behind
  a shared token (a `?token=` / `Authorization` check, value from `CONSOLE_TOKEN`), and reach it
  either on a dedicated port on the dev host or via a tunnel. Read is token-gated; writeback
  requires the token too. (Details and the exact port live in `plan.md`; it must not collide
  with the app stack ports.)
- Because state is just files, the server is stateless and disposable — it can run on this
  machine, on the dev box pointed at a synced checkout, or in a tiny container.

## What this deliberately does not do

- No independent process monitoring (see non-goals). Task status is agent-reported.
- No mirror of PR diffs or inline code review — it links to GitHub and shows PR status only.
- No editing of the agent's work state from the UI — writeback is answers and notes only.
- No live interruption of a running turn — feedback is queued for the next turn / `/loop` tick.
