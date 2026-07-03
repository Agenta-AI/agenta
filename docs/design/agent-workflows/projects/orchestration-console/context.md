# Context — the orchestration console

## Why this exists

Mahmoud drives feature work by talking to a single **orchestrator agent** that runs many
sub-agents (research, design, implementation, debugging). A non-trivial effort spawns dozens
of parallel threads: sub-features, route choices, open questions, decisions, running tasks.

Two parts of this loop already work well, because they have a good **async review surface**:

1. **Design phase.** A sub-agent writes design docs, commits them to a branch, opens a draft
   PR, adds a top comment explaining the change, and adds inline comments on the spots that
   need a call. Mahmoud reviews on GitHub at his own pace. This works.
2. **Implementation phase.** Same shape — draft/real PR, top comment, inline pointers,
   `needs-review` label. Reviewed on GitHub. This works.

The part that does **not** work is everything **in between and around** those two phases —
the orchestration itself:

- Deciding how to break a feature into sub-features.
- Deciding which route to take to solve a problem.
- Debugging sessions (no PR, just findings and choices).
- The running status of each sub-agent / task.
- The decisions that need Mahmoud's call, each with its own context.
- Where his feedback is needed right now, and what's new since he last looked.

Today all of that lives in the **chat transcript**. Chat is linear, unstructured, and has no
"what needs me / what's new" view. With 100 threads it becomes impossible to track.

## The attempt that got the content right

`docs/design/agent-workflows/scratch/pr-4936-followup/` is a hand-built version of the
answer. One folder, a `README.md` index, one file per thread. Each thread carries
**Context / Explanations / History / Open decision threads**. The README carries **What needs
your review NOW**, an **Open decisions** table (`# | Where | Decision | My rec`), **Decided
(locked)**, and **In flight**. The information captured there is exactly right.

What's missing around it:

1. **No consistent structure.** Every project reinvents the format, so nothing can read it
   but a human, and only by opening files.
2. **No freshness / attention view.** There's no "what changed since I last looked" and no
   single "what needs me right now." Mahmoud has to ask the agent "what's new? what should I
   update?" every time.
3. **No writeback.** The only way to answer a decision is to type into chat. He wants to
   answer from a UI, so several decisions get resolved in one place instead of one chat
   round-trip each.

## The problem, stated crisply

> Give the **orchestration phase** the same async-review affordance that the draft PR gives the
> design and implementation phases: a structured, always-current, attention-routing surface
> with two-way feedback — backed by git-native Markdown files, and linking out to the PRs and
> design docs rather than duplicating them.

## Goals

- One dashboard that answers, at a glance: *what is this project trying to do, which tasks /
  sub-agents are running, where are we in the plan, what needs my decision (with context), and
  what's new since I last looked.*
- A **protocol** (structured Markdown + a machine-readable event stream) the orchestrator
  writes through a small CLI, so the format is consistent and a UI can render it.
- A **skill** that teaches the orchestrator when and how to write to the console.
- Edits to the existing orchestration skills (`queue-implement-feature`, `implement-feature`)
  so the console is updated at the natural hook points instead of ad-hoc scratch files.
- A **simple, deployable UI** on its own port, reachable from outside this machine, where
  Mahmoud reads state and submits feedback / decisions without opening chat.

## Non-goals

- **Not** a replacement for the GitHub PR review flow. Design docs and code still land as PRs
  and are reviewed there. The console *links to* a PR and shows its status; it does not
  re-implement inline code review.
- **Not** a live process monitor. The console reflects what the orchestrator *tells* it via
  the CLI. It cannot independently see OS processes or introspect a running Claude Code
  session. "Which sub-agents are running" means "which tasks the orchestrator marked running."
- **Not** a general project-management tool (no Jira). Scope is one person orchestrating
  agents on this repo.
- **Not** a real-time push into a live chat turn. Feedback submitted in the UI is *queued* for
  the orchestrator to pick up on its next turn (or its next `/loop` tick). Honest framing:
  the UI removes the round-trips, it does not interrupt a running turn.

## Who reads / writes what

- **Orchestrator agent** — writes almost everything (tasks, decisions, feed messages, status),
  via the CLI. Reads pending user feedback at the start of each turn.
- **Sub-agents** — may append feed messages and update their own task's status; the
  orchestrator remains the owner of decisions.
- **Mahmoud** — reads the dashboard; writes answers to decisions and free-text notes, via the
  UI. Never hand-edits the files (same rule as today's `STATUS.md`).
