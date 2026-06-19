---
name: write-pr-description
description: Write PR titles and descriptions the way a staff engineer would. Use when drafting or editing a pull request title and body, before running `gh pr create`, or any time the user asks for a PR description, summary, or release-notes-style writeup of a change. Apply this skill from the start, not as a cleanup pass after a generic first draft.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Write PR Descriptions

Write PRs that a teammate can understand at a glance. Lead with what was broken from the user's point of view, then show the fix in plain words with a concrete before/after. No padding, no checkbox theater, no jargon-first openings.

This is the default quality bar from the first draft. Don't ship a generic version expecting to fix it after feedback.

## 1. Title

The title states the actual change in plain words.

- Use the conventional prefix the repo already uses, e.g. `[fix] <Title>`, `[feat] <Title>`, `[chore] <Title>`, `[docs] <Title>`.
- If the user gave you an issue id, suffix it: `[fix] <Title> [AGE-1234]`.
- Define the title as an active intent in present tense, e.g `[fix] Resolve broken evaluation links`.
- Keep it under ~70 characters. Detail goes in the body.

Good vs bad:

- Good: `[fix] Map OpenInference tool definitions into real tool objects`
- Bad: `fix(api) parse X into structured objects` (abstract, says nothing concrete)
- Bad: `Update tool handling` (vague, no symptom, no domain)

## 2. Body structure

Use this shape unless the change is truly trivial:

```
## Context
<one or two sentences: the symptom a user or teammate would notice, then the root cause in plain words>

## Changes
<plain-words explanation of the change, with a concrete before/after when a data shape, signature, or behavior changed>

## Tests / notes
<short bullet list or prose: what you verified, anything reviewers should watch for>

## What to QA
<only for user-visible changes: short steps for the manual tester, see section 7>
```

Adapt the headings if the situation calls for it (e.g. a pure feature PR might use "What this adds" instead of "What was broken"). The order stays the same: the obeservation (symptom or user-visible change first or intent), then the changes, then verification and validation.

## 3. Show, don't restate the diff

When a transformation changed a data shape, signature, or behavior, show it concretely.

Good:

> Tool definitions coming from OpenInference traces arrived as
>
> ```
> [{tool: {json_schema: "..."}}]
> ```
>
> The playground expected
>
> ```
> [{type: "function", function: {...}}]
> ```
>
> So the parser now unwraps `json_schema` and rebuilds each entry in the expected shape before handing it to the playground.

Bad:

> - Updated tool parsing logic
> - Improved data handling
> - Added support for OpenInference tools

The second version restates the diff in vague bullets. It tells the reader nothing the file list doesn't.

## 4. Cut the padding

Things to remove before you publish:

- Generic "Summary" or "Overview" sections that paraphrase the title.
- Checkbox theater ("- [x] code written - [x] tested") unless the repo's template requires it.
- Bullet lists that restate every changed file. The diff already shows that.
- Marketing words: "comprehensive", "robust", "seamlessly", "leverage", "powerful".
- Bullets that exist only to fill space. Prefer one clear sentence to three vague bullets.

## 5. Prose rules

Apply these general writing rules:

- **No em dashes.** Replace with a period and a new sentence, parentheses, or a semicolon. Absolute rule.
- Active voice.
- Short sentences by default. Longer ones only when they help the flow.
- Complete sentences. Snippets are fine when they keep things short and clear.
- Don't overuse bold or bullets. Use them when they aid quick reading. Otherwise prose.
- 11th-grade English, except for unavoidable technical terms.

## 6. Tests / notes section

Keep this section short and concrete. Useful contents:

- What you ran locally (`pnpm test`, `pytest tests/...`, manual UI check on `/observability`).
- Anything reviewers should poke at (a known-fragile area, a follow-up not in this PR).
- Migration or rollout notes if relevant.

Skip the section entirely if there is nothing real to say. A blank "Tests" heading is worse than no heading.

## 7. What to QA section

If the change is user-visible and a teammate will test it manually, add a "What to QA" section. Write it for a tester who knows the product and has context: skip the basics, point at the right screens, and state the expected result of every check.

- One line per check: where to go, what to do, what they should see.
- Name the exact pages and flows. "Test the feature" is not a check.
- Include the regression to watch for: the thing this change is most likely to have broken.
- If a check needs setup (a seeded project, an older record, a feature flag), say so in the same line.
- Use simple, clear language. Same prose rules as section 5.

Example:

> ## What to QA
> - Create a new automatic evaluator, name it, save. The table shows your name with a v1 tag, not "default".
> - Edit it and commit a config change. The name stays, the version bumps to v2.
> - Regression: run a new evaluation. The variant chips still say "default", not the app name.

Skip the section when nothing is user-visible (pure refactor, CI, docs). A reviewer-only change needs the Tests section, not this one.

## 8. Reviewer's first-30-seconds test

Before you finalize, read your own draft and ask:

1. After 30 seconds, does a reviewer know **the context** and **what changed**?
2. Is there a concrete before/after anywhere a shape or behavior moved?
3. Did you delete every sentence that doesn't earn its place?
4. Did you scan for em dashes and marketing words?

If any answer is no, edit before you push.

## 9. Worked example

A bad first draft:

```
## Summary
- Updated the tool parsing logic to handle OpenInference traces
- Improved compatibility with the playground
- Added robust error handling for edge cases

## Includes
- Modified parseTools function
- Updated type definitions
- Added new test cases
```

A good rewrite:

```
## Context
When you opened an OpenInference trace in the playground, the tools panel was empty. The trace stored tool definitions as `[{tool: {json_schema: "..."}}]`, but the playground expected the OpenAI shape `[{type: "function", function: {...}}]`, so the parser dropped them silently.

## Changes
`parseToolsFromTrace` now unwraps `json_schema` and rebuilds each entry in the OpenAI shape before it hits the playground. Traces that already use the OpenAI shape pass through unchanged.

Before:
[{tool: {json_schema: "{\"name\": \"get_weather\", ...}"}}]

After:
[{type: "function", function: {name: "get_weather", parameters: {...}}}]

## Tests
- Added a unit test in parseToolsFromTrace.test.ts covering both shapes.
- Opened a real OpenInference trace from the staging project and confirmed the tools panel renders.

## What to QA
- Open an OpenInference trace in the playground (the staging project has them). The tools panel lists the tools.
- Regression: open a trace from the OpenAI SDK. The tools panel still renders as before.
```

The second version is cleaner and tells the reviewer everything they need to start reading the diff.
