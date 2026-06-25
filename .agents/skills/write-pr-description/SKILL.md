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
<one or two sentences: the symptom a user or teammate would notice, then the root cause in plain words.
This is REQUIRED — reviewers must know WHY this change exists before they can evaluate it.>

## Changes
<plain-words explanation of the change, with a concrete before/after when a data shape, signature, or behavior changed>

## Scope / risk
<what this PR does NOT do, known limitations, follow-ups filed, and anything that could regress.
This is REQUIRED for any non-trivial PR — reviewers always ask "what did you not touch?" and
"what could break?". Skip only for truly trivial changes (typo fix, one-line rename).>

## Tests / notes
<short bullet list or prose: what you verified, anything reviewers should watch for>

## How to QA
<required when the change is user-visible or touches a code path a reviewer can exercise;
see section 7 for the full spec>
```

Adapt the headings if the situation calls for it (e.g. a pure feature PR might use "What this adds" instead of "What was broken"). The order stays the same: the observation (symptom or user-visible change first or intent), then the changes, then scope/risk, then verification and validation.

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

## 7. How to QA section

Add a "How to QA" section whenever the change is user-visible OR touches a code path a reviewer can exercise (API endpoint, CLI flag, config option). Skip it only for pure refactors, CI changes, and doc-only commits. A reviewer who cannot run the stack should still be able to understand what the expected outcome is.

Write it for a reviewer who knows the product but has not read the diff. Structure it in five parts:

**Prerequisites.** Name the stack or environment to use (e.g. "local dev stack via `run.sh`", "the Hetzner dev box at the live port", "a local `pytest` run"). List any one-time setup: a feature flag to flip, an env var to set, a project to seed, a dependency to start. Be specific enough that someone cold can follow without guessing.

**Steps.** Number each action. For UI changes: name the exact page or panel, what to click or fill, in what order. For backend changes: the exact curl command or test invocation, including any required headers or payloads. For CLI changes: the exact command. Do not say "test the feature" — say what to do.

**Expected result.** State what you should see after the steps. One sentence per check is enough. Be concrete: a value, a label, a response field, a rendered panel — not "it works".

**Automated tests.** List the test files or test IDs that cover this change and the exact command to run them locally. If there are no automated tests, say so explicitly. Reviewers should not have to hunt for coverage.

**Edge cases / what to watch for.** Name the one or two things this change is most likely to have broken (the regression), and any inputs or states where the behavior might differ from the happy path.

Example:

> ## How to QA
>
> **Prerequisites:** local dev stack (`docker compose up`, or `run.sh` with the `--dev` flag). No extra setup needed.
>
> **Steps:**
> 1. Open the Playground at `/apps/<any-app>/playground`.
> 2. Select an automatic evaluator variant. Click "Edit config".
> 3. Change the name field. Click "Save".
>
> **Expected result:** The evaluator table shows the new name with a v1 tag. The variant selector still shows the old name until you refresh.
>
> **Automated tests:**
> ```
> pnpm --filter @agenta/evaluators test -- --run evaluator-name
> ```
>
> **Edge cases:** If you edit a variant that already has run results attached, the name change must not affect the run history rows. Check one such variant.

## 8. Reviewer's first-30-seconds test

Before you finalize, read your own draft and ask:

1. After 30 seconds, does a reviewer know **the context** (the symptom, the why) and **what changed**?
2. Is there a concrete before/after anywhere a shape or behavior moved?
3. Does the **Scope / risk** section tell reviewers what was NOT touched and what could regress?
4. Does **How to QA** give a concrete path: prerequisites, numbered steps, expected result, exact test command, and edge cases?
5. Did you delete every sentence that doesn't earn its place?
6. Did you scan for em dashes and marketing words?

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

## Scope / risk
This only affects the OpenInference parser. Traces from the OpenAI SDK and Anthropic SDK pass through the existing path unchanged. The playground tool panel is the only UI surface touched.

## Tests
- Added a unit test in parseToolsFromTrace.test.ts covering both shapes.
- Opened a real OpenInference trace from the staging project and confirmed the tools panel renders.
  ```
  pnpm --filter @agenta/observability test -- --run parseToolsFromTrace
  ```

## How to QA

**Prerequisites:** local dev stack or the staging environment. The staging project already has OpenInference traces.

**Steps:**
1. Open the Observability page and click any OpenInference trace.
2. Open that trace in the Playground via the "Open in Playground" button.
3. Check the Tools panel on the right side of the Playground.

**Expected result:** The tools panel lists all tool definitions from the trace. Each entry shows a name and the parameter schema.

**Automated tests:**
```
pnpm --filter @agenta/observability test -- --run parseToolsFromTrace
```

**Edge cases:** Open a trace from the OpenAI SDK (not OpenInference). The tools panel must still render as before — the new parser must not touch the existing shape.
```

The second version is cleaner and tells the reviewer everything they need to start reading the diff.
