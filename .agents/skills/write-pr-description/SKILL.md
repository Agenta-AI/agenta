---
name: write-pr-description
description: Write PR titles and descriptions the way a staff engineer would. Use when drafting or editing a pull request title and body, before running `gh pr create`, or any time the user asks for a PR description, summary, or release-notes-style writeup of a change. Apply this skill from the start, not as a cleanup pass after a generic first draft.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Write PR Descriptions

Write PRs that a teammate can understand at a glance. Lead with what was broken from the user's point of view, then show the fix in plain words with a concrete before and after. Leave out padding, checkbox lists and openings that start with jargon.

This is the default quality bar from the first draft. Don't ship a generic version and expect to fix it after feedback.

## 0. The prefilled template

GitHub prefills every PR from `.github/PULL_REQUEST_TEMPLATE.md`, which asks for Summary, Testing, Demo, Checklist, and Contributor Resources. That is not what this repo's PRs look like. Replace the prefilled body with the structure in section 2.

Two parts of the template still apply:

- **Tests.** Keep the substance under a `## Tests` heading. You do not need the template's three subheadings unless the change is large enough that they help.
- **Demo.** Every PR shows proof of the change in a `## Demo` section after Tests. See section 7.

Drop the Checklist and Contributor Resources if the author is a core maintainer of the repo. They exist for first-time outside contributors and the team does not fill them in.

## 1. Title

The title states the actual change in plain words. Use the format from the "PR instructions" in the root `AGENTS.md`:

- `<type>(<area>): <Title>`, where the type is one from the AGENTS.md list (`fix`, `feat`, `chore`, `ci`, `docs`, `test`), and the area is `frontend`, `api`, `sdk`, `runner`, `services`, `docs` and so on.
- If the user gave you an issue id, put it first: `[AGE-1234] fix(frontend): <Title>`.
- Write the title as an action in the present tense.
- Keep it under about 70 characters. Detail goes in the body.

Good and bad titles:

- Good: `fix(frontend): Show agent-created automations without a reload`
- Good: `fix(runner): let a tool's own time budget extend the tool-call watchdog`
- Bad: `fix(frontend): improve trigger handling` (vague, no symptom)
- Bad: `Update chat hooks` (no type, no area, no symptom)

## 2. Body structure

Use this shape unless the change is truly trivial:

```
## Context
<one or two sentences: the symptom a user or teammate would notice, then the root cause in plain words>

## Changes
<plain-words explanation of the change, with a concrete before and after when a data shape, signature, or behavior changed>

## Tests
<short bullet list or prose: what you verified, and anything reviewers should watch for>

## Demo
<proof of the change, see section 7>

## What to QA
<only for user-visible changes: short steps for the manual tester, see section 8>
```

Adapt the headings if the situation calls for it. A feature PR can use "What this adds" in place of "Context". The order stays the same: first the symptom or the user-visible change, then the changes, then the proof.

## 3. Show, don't restate the diff

When a change moved a data shape, a name, or a behavior, show it concretely.

Good:

> The Claude harness reports the trigger op as
>
> ```
> mcp__agenta-tools__create_schedule
> ```
>
> The hook matched only the bare name
>
> ```
> create_schedule
> ```
>
> So the hook now passes each name through `canonicalClientToolName` before the match. Pi, Claude and Codex names all match, and a third-party `mcp__acme__create_schedule` does not.

Bad:

> - Updated tool name handling
> - Improved trigger support
> - Added support for more harnesses

The bad version restates the diff in vague bullets. It tells the reader nothing the file list doesn't.

## 4. Cut the padding

Remove these before you publish:

- Generic "Summary" or "Overview" sections that repeat the title.
- Checkbox lists ("- [x] code written - [x] tested").
- Bullet lists that name every changed file. The diff already shows that.
- Bullets that exist only to fill space. One clear sentence is better than three vague bullets.

## 5. Prose rules

Follow the `style-editing` skill for all prose. The rules that apply only to PRs are:

- Put file, function and test names in backticks so a reviewer can search for them.
- Use bold and bullets only where they help a reviewer scan. Otherwise write prose.
- Name the issue or PR that a change builds on (`#8271`), and say what it left undone.

## 6. Tests section

Keep this section short and concrete. Useful contents:

- What you ran (`pnpm test` for one package, `pytest` for one file, a manual check of the playground at `/m`).
- Which test fails without the change and passes with it.
- Anything reviewers should check (a fragile area, a follow-up that is not in this PR).
- Migration or rollout notes, if any.

Skip the section if there is nothing real to say. An empty "Tests" heading is worse than no heading.

## 7. Demo section

Every change ships with proof that it does what the PR says. Put a `## Demo` section after Tests.

- A visible UI change gets before and after screenshots from the real app running the branch (web/mobile at `/m`). Capture the "before" ahead of the first edit. Never use a mock-up, a component harness, or a recreated screen.
- Motion, timing or loading states get a short video or a sequence of frames.
- A logic, data or protocol fix names the test that failed before the change and passes now.
- A server-only change gets the test and a short runtime transcript.

Use one table per screen, with one line on top that says which screen, which data, and what you did. Add a row under the images that says what to notice:

```markdown
## Demo

<one line: which screen, which data, what was done>

| Before | After |
|---|---|
| <img width="400" alt="before-<what>" src="https://github.com/user-attachments/assets/..." /> | <img width="400" alt="after-<what>" src="https://github.com/user-attachments/assets/..." /> |
| <what is wrong> | <what is fixed> |
```

For a new feature with no "before", use one column per state, such as `| Empty | Filled | Error |`. Upload images through the PR page so they get `user-attachments` URLs. Never commit them. If you cannot capture a proof, say which one is missing and why. Don't fill the space with something that proves nothing.

## 8. What to QA section

If the change is user-visible and a teammate will test it by hand, add a "What to QA" section. Write it for a tester who knows the product. Point at the right screens and state the expected result of every check.

- Write one line per check: where to go, what to do, and what they should see.
- Name the exact pages and flows. "Test the feature" is not a check.
- Include the regression to watch for, which is the thing this change most likely broke.
- If a check needs setup (an agent with a given harness, a connected channel, a feature flag), say so in the same line.

Example:

> ## What to QA
> - Open a playground session and ask the agent to create a schedule. Do not reload. The Automations section shows the schedule when the turn finishes.
> - Ask the agent to remove the schedule. The section goes back to "Add one" without a reload.
> - Regression: ask the agent to write a file. The Recent files list still updates during the turn.

Skip the section when nothing is user-visible (a refactor, CI, docs). A change that only reviewers check needs the Tests section, not this one.

## 9. Reviewer's first-30-seconds test

Before you finalize, read your own draft and ask:

1. After 30 seconds, does a reviewer know **the context** and **what changed**?
2. Is there a concrete before and after where a shape or behavior moved?
3. Does the Demo section hold real proof?
4. Did you delete every sentence that adds no fact?

If any answer is no, edit before you push.

## 10. Worked example

A bad first draft:

```
## Summary
- Updated the file activity hook to handle triggers
- Improved compatibility with all harnesses
- Added robust handling for edge cases

## Includes
- Renamed useFileActivityDetector
- Updated settledTools model
- Added new test cases
```

A good rewrite, based on PR #8267:

```
## Context
When an agent created an automation from the playground chat, the Automations section in the config pane kept saying "Add one" until a hard refresh. The runner calls the API directly, so the browser gets no signal except the settled tool call in the chat stream, and `/m` never refetched the trigger lists. The Claude harness also names the op `mcp__agenta-tools__create_schedule`, so a match on the bare name missed it.

## Changes
`useFileActivityDetector` becomes `useSettledToolEffects`. It scans the turn's settled tool calls once and applies both side effects:

- A call that writes files records file activity for the session's drives. This is unchanged.
- A trigger op that changes data invalidates `["triggers", "schedules"]` or `["triggers", "subscriptions"]`.

Names go through `canonicalClientToolName` first, so Pi, Claude and Codex names all match.

## Tests
- `useSettledToolEffects.test.tsx` covers create during the stream, remove, pause and resume, the Claude name, failed and read-only calls, and session switches. With the invalidation removed, 10 of the 14 tests fail.
- On the local EE stack at `/m`, a Claude Code agent created and removed a schedule, and the pane showed each change within 9 seconds with no reload.

## Demo
Playground session of the "Competitor Digest" agent. I asked the agent to create a weekly schedule and did not reload the page.

| Before | After |
|---|---|
| <img width="400" alt="before-agent-created-automation" src="https://github.com/user-attachments/assets/..." /> | <img width="400" alt="after-agent-created-automation" src="https://github.com/user-attachments/assets/..." /> |
| The agent reports the schedule as created, but Automations still says "Add one". | The new schedule shows under Automations a few seconds after the turn. |

## What to QA
- Ask the agent to create a schedule. Do not reload. The Automations section shows it when the turn finishes.
- Regression: ask the agent to write a file. The Recent files list still updates during the turn.
```

The rewrite tells the reviewer the symptom, the cause, the fix and the proof before they open the diff.
