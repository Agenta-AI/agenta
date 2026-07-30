---
name: write-issue
description: Write and file Linear issues (bugs and feature requests) the Agenta way. Use when the user asks to create, file, or draft a Linear or GitHub issue, write a bug report or feature request, or turn a problem into a tracked issue. Covers the title format, reproduction-first structure, when to use a todo list, and the team/project/label/priority/state conventions, plus filing it through the Linear MCP so the linked GitHub issue is auto-created and the PR links back.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Write Issues

Write issues a teammate can act on without asking you follow-up questions. Lead with what
the reader needs to reproduce or understand the request, not with your analysis.

Show a draft first and let the user react before you create anything in Linear.

## 1. Title

Prefix the title with the type in parentheses, the same way the repo prefixes PRs.

- `(bug)` for something broken.
- `(feat)` for a new capability or improvement.
- Other types as needed: `(chore)`, `(docs)`.

State the symptom or the request in plain words. Keep it short.

- Good: `(bug) Feedback sent via the API can't be filtered in observability`
- Good: `(feat) Filter evaluation results by metric value`
- Bad: `(bug) Annotation filter options array empty due to thin refs` (that is the root cause, not the symptom)
- Bad: `Observability issue` (vague)

## 2. Body — bugs

Do not open with a "Context" heading. Start with the reproduction, in the user's voice:
when I do this, I expect that, but instead this happens. Or: this code is supposed to do
X, but it does Y. Keep the words simple.

Then give the concrete information a teammate needs to debug it, when you have it:

- Exact steps to reproduce, numbered.
- Requests and responses (the call you made and what came back).
- Errors, console output, or relevant log lines.
- Screenshots or screen recordings.
- Where it reproduces (local, preview, Railway, cloud) and the version if known.

That is the whole job: make it reproducible. Include real payloads over descriptions of
them.

## 3. Do not write the root cause

The issue tracks the problem, not the investigation. Do not add a "root cause" or "why
this happens" section. That analysis belongs in the PR that fixes it (see the
`write-pr-description` skill). Keep the issue about observable behavior and the
information needed to debug it.

If you already know the cause, it still does not go in the issue body. Put it in the PR.

## 4. Body — feature requests

Lead with the problem or the goal from the user's point of view: what they are trying to
do and why it is hard today. Then describe the behavior they want. Skip implementation
design unless the user asked for it.

## 5. Todo list

Add a checkbox list only when delivery is split across stacked PRs or has several ordered
steps. One line per step, written as an outcome.

```
- [ ] Fix the filter so it reads the evaluator's real feedback metrics.
- [ ] Fix how the frontend reads the feedback type so the nested schema is understood.
```

If a single PR closes the whole issue, skip the todo list. Do not pad an issue with
checkboxes for its own sake.

## 6. Linear fields

File issues on the **Agenta** team (key `AGE`). Pick the fields deliberately.

**Project** (set one):
- **Bugs** — the default home for bug reports.
- **Quality of life improvements** — small improvements that do not belong to a feature project.
- The active feature project when the work is part of one (for example Annotation Queues,
  Core Loop Improvements, Reliability Availability Scalability & Performance, Documentation,
  New integrations for observability, DevSecOps & DevEx). List active projects with
  `mcp__linear-server__list_projects` and match by area.

**Labels** (combine a type label with the relevant area labels):
- Type: `Bug Report`, `Feature Request`, `Question`, `Chore`, `refactoring`, `tech-debt`.
  Use `unconfirmed bug` or `reproduction-needed` when you could not reproduce it yet.
- Area: `frontend`, `Backend`, `SDK`, `API`, `observability`, `Tracing`, `Workflows`,
  `evaluation`, `human evaluation`, `playground`, `prompt management`, `Services`,
  `database`, `infrastructure`, `integration`, `security`, `analytics`.
- UX: `UX`, `ux bug`, `dev experience`.
- Visibility: `Public` marks an issue mirrored to the public GitHub repo. This is the label
  the GitHub sync watches, so set it when you want the linked GitHub issue created (see
  section 7). Use `Core Team` / `Internal Team` for internal-only issues.

**Priority** (`0` None, `1` Urgent, `2` High, `3` Medium, `4` Low):
- `1` Urgent: data loss, outage, or drop-everything.
- `2` High: important and should land soon.
- `3` Medium: the default for a normal bug.
- `4` Low / `0` None: minor or nice-to-have.

**State** flow: `Todo` → `In Progress` → `In Review` → `In QA` → `Done`. Use `Backlog` for
later, `Canceled` / `Duplicate` as needed. New issues start in `Todo`; move to `In Progress`
once work has started.

## 7. Filing it and linking the PR

Create with `mcp__linear-server__save_issue` (no `id` field creates a new issue). Pass
`team`, `title`, `description` (Markdown, literal newlines), `project`, `labels`,
`priority`. Link related issues with `relatedTo`, and attach the PR with `links`
(`[{url, title}]`).

The workspace runs a Linear ↔ GitHub sync that creates a linked GitHub issue when the
`Public` label is set. After creating the Linear issue, find the auto-created GitHub issue
(`gh issue list --repo Agenta-AI/agenta --search "<keywords>"`, allow a few seconds for the
sync), then link the PR to it by adding `Closes #<n>` (or `Refs #<n>` when the PR is only
part of the issue) to the PR body. The sync then moves the Linear issue as the PR opens and
merges.

To move the issue yourself, call `save_issue` again with the issue `id` and `state: "In Progress"`.

## 8. Checklist before you create

- Title prefixed with `(bug)` / `(feat)` and states the symptom or request, not the cause.
- Bug opens with reproduction in plain words, then steps + real requests/responses/logs.
- No root-cause section.
- Todo list only if the work is stacked or multi-step.
- Team, project, labels, priority set. `Public` added if it should sync to GitHub.
- After creating: GitHub issue found, PR links to it, Linear state set as the user asked.
