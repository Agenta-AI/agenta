# Orchestration console — planning workspace

A dashboard for the **orchestration phase** of agent work: what a project is trying to do, which
sub-agents/tasks are running, where your decision is needed (with full context), and what's new
since you last looked — backed by git-native Markdown files, with feedback you submit from a UI
instead of chat.

**The gap it fills:** design docs and code get reviewed async on GitHub draft PRs, which works.
The orchestration in between (breaking a feature down, choosing routes, debugging, tracking
tasks, surfacing decisions) lives in chat, which is unmanageable at 100 threads. The console
gives that phase the same async-review affordance the PR gives the other two.

## Read in this order

1. **`context.md`** — the problem, goals, non-goals.
2. **`research.md`** — how we orchestrate today; the scratch/PR conventions the console
   subsumes or links to; the hook points in the orchestration skills.
3. **`design.md`** — the solution: the file protocol (schema by semantic role), the CLI action
   surface, the web dashboard, and deployment. **Start here for the "how it works".**
4. **`skill-integration.md`** — the new `orchestration-console` skill plus the surgical edits to
   `implement-feature` and `queue-implement-feature`.
5. **`plan.md`** — the six-phase build order.
6. **`status.md`** — current state (built + tested, awaiting review) and the open questions.
7. **`TESTING.md`** — how to test it, in three layers (plumbing / web loop / skill integration).

The working tool lives in **`tool/`**: `console_store.py` (protocol), `console.py` (CLI),
`console_web.py` (dashboard), `test_console.py` (11 tests). The skill is at
`.claude/skills/orchestration-console/SKILL.md`.

## The shape in one picture

```
orchestrator agent ──writes──►  console CLI  ──►  console/<project>/
                                                     project.md   (overview / goal / status)
   reads pending  ◄──────────────┐                   tasks/*.md   (sub-agents, status, PR link)
   at start of turn              │                   decisions/*.md (needs-you, options, rec)
                                 │                   feed.jsonl   (what's new)
                                 │                       ▲
   Mahmoud ──reads dashboard, ───┴───writes answers──────┘
            answers decisions        (web app, own port, external)
```

The design docs and PRs stay where they are. The console links to them; it is the attention
layer over the whole effort, not a replacement for the PR review flow.
