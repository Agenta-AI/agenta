# QA Inventory — `fe-feat/mustache-support` (Mahmoud's QA pass, 2026-06-01)

Slack thread: https://agentagroup.slack.com/archives/C0B4K2KFUJF/p1780309601153369
Branch: `fe-feat/mustache-support` · Latest commit at QA time: `d9066e6c2f`

Tracking nine QA issues from the 2026-06-01 thread — Mahmoud reported
seven (10:26-10:40Z), Kaosiso added two more later (11:38Z, 12:19Z).
Mahmoud stopped his pass after item 7 citing a post-merge regression.

Legend: 🔴 not started · 🟡 in progress · 🟢 fixed · ⚪ deferred

## Summary

| # | Issue | Reporter | Status | Commit / next step |
|---|---|---|---|---|
| 1 | Tracing broken in playground | Mahmoud | 🟢 resolved | Transient at QA time — Arda confirmed traces work locally 2026-06-01 on a synced branch |
| 2 | Variables "closing" after first letter (mustache) | Mahmoud | 🟢 fixed | (commit pending) — TokenPlugin cursor-jump-out, same fix as #8 |
| 3 | Mustache form: can't add second sub-field | Mahmoud | 🟢 fixed | `e26ca33a47` |
| 4 | Text/markdown swapped in messages dropdown | Mahmoud | 🟢 fixed | `1e6dfa92ee` + `c1c1a8efda` |
| 5 | Chat: `messages` in unused-columns footer | Mahmoud | 🟢 fixed | `e08cb4e772` |
| 6 | Chat multi-testcase regression | Mahmoud | 🟢 fixed | `e08cb4e772` + `577da0e741` (radio rows) |
| 7 | Autocomplete broken (post-merge regression) | Mahmoud | 🟢 fixed | `693ac2457e` |
| 8 | Cursor jumps outside `{{...}}` after first char (mustache) | Kaosiso | 🟢 fixed | (commit pending) — TokenPlugin cursor-jump-out, same fix as #2 |
| 9 | `curly` option disappears from picker after switching away | Kaosiso | 🟢 fixed | `3731ac9d49` + `909ba25129` |

**9 of 9 fixed and pushed.** Mahmoud's tracing report (#1) was transient
— our branch's FE tracing code is byte-identical to main, all of JP's
PR #4491 tracing fixes are integrated, and Arda confirmed traces work
locally on the synced branch. Likely a staging-deploy timing issue at
QA time (FE post-#4469 deployed but backend pre-#4491, or similar
state mismatch).

---

## 1. 🔴 Tracing not working in the playground

**Slack ts:** 1780309654.194819 · screenshot: `F0B88EP7EPJ`
**Tagged:** @jp

> Tracing is not working in the playground. No traces are generated when
> you make a call from the playground. Invoke returns a trace_id but it
> is nowhere to be found.

**Context (2026-06-01 Arda DM):** Tracing broke after PR #4469 was
merged into main. JP's follow-up PR #4491
(`fix/broken-tracing-and-workflow-events`) fixed it on main. Arda
suspects the regression is local to our branch — i.e., something in
our merge of `feat/add-mustache-rendering` interacts badly with the
post-#4469 tracing fixes.

**Static-analysis findings (no code-level regression visible):**

All tracing-related FE files are BYTE-IDENTICAL to main:
- `web/packages/agenta-entities/src/workflow/state/runnableSetup.ts`
  (where `references` for trace attribution is built)
- `web/oss/src/services/tracing/api/index.ts` (trace fetch endpoints)
- `web/packages/agenta-entities/src/trace/api/api.ts` (trace fetch
  endpoints)
- `executionItems.ts` references-passing block (lines 1080-1084)
- `workflow/state/store.ts` (sourceRef setter)

All tracing-fix commits from PR #4491 are reachable from branch HEAD:
- `b1b5b899df` [fix] Resolve broken tracing events
- `83495a340a` Add workflow events, fix web endpoints
- `601c9de468` cleanup related web/tracing files
- `69379a9f04` back to legacy endpoints (`/tracing/spans/query` etc.)
- `301f74f65f` fix: comment out unused event types
- `92be0a87e2` Merge PR #4491

Our branch's actual diff vs main is concentrated in mustache token
plugin, playground inputs body, visibility rule, template format
picker, schema-aware seeding, view-type ordering, chat single-
testcase gate, and the native-vs-stringified input transport change.
NONE of these touch the trace pipeline, references building,
sourceRef construction, or tracing endpoints.

**Plausible hypotheses (need verification):**

1. **Premise re-check.** "Main playground traces work" may need
   re-verification on the latest main HEAD (`d7c60c14e6`). If main
   is also broken with the same repro, the regression isn't
   branch-specific — it's something missing in main itself.

2. **Indirect effect from native-input transport.** The only
   semantically meaningful difference that touches the request body
   is `executionItems.ts` switching variable values from
   `Record<string, string>` to `Record<string, unknown>` (gap-04
   fix). If the backend's trace-saving pipeline serializes the
   `inputs` field for storage and chokes on nested-object inputs,
   the trace_id would be generated but the trace would fail to
   persist. Low-probability but the only code-level hypothesis I
   can construct.

3. **Environmental.** Staging deploy state mismatch, build cache,
   or env var. Not code-related.

**Recommended next steps:**

1. Confirm the premise — re-test the same repro on the LATEST main
   HEAD. If broken there too → hand off to JP for backend
   investigation (this isn't a branch regression).
2. If main is genuinely working: capture the request body sent
   on our branch vs main during an invoke, diff the wire format.
   Possible places to look: `request.inputs` shape, `request.
   references` content, `request.ag_config` template_format value.
3. Failing both, hand off to JP with the trace_id Mahmoud captured
   plus the staging URL — he owns the backend trace pipeline and
   can read the server-side logs that the FE can't.

**Owner candidate:** JP (backend) once a confirmed branch-vs-main
delta is captured, OR me (FE) if step 2 reveals a wire-format gap.

---

## 2. 🔴 Variables panel closes after every keystroke (mustache only)

**Slack ts:** 1780309753.298959 · video: `F0B7C4EKLTG`
**Tagged:** @U0836QZFMMY (Arda, FE)

> Variables keep closing automatically after the first letter. This
> happened with an app that was curly after I swapped it to mustache.
> Refreshing did not solve the issue. Reproduce in another app with the
> same behavior after switching.
>
> Actually it seems it happens always in mustache. Just created a new
> app and while in the drawer, it's the same behavior.

**Likely cause (unverified):** *Different* from the `FormView` focus-
loss we already fixed in `a52ca93827`. Mahmoud says "variables keep
closing" — not "focus jumps". Sounds like a panel/card/drawer that
auto-collapses on prompt edit, mustache-only.

Candidates to investigate:
- The `VariableCard` itself remounting on every prompt edit because
  some upstream `key` is recomputed per-stroke (similar anti-pattern to
  the `FormView` one but in a different surface).
- The new `unreferenced-columns` footer key — `key={unreferencedColumns
  .map((c) => c.name).join("|")}` in `PlaygroundInputsBody.tsx` —
  re-mounts when the column set changes. If port discovery in mustache
  re-emits the set unstably on every keystroke (e.g. extractor returns
  variables in inconsistent order), the footer remounts and looks like
  "closing".
- An OSS-side drawer / collapse atom that resets when entity data
  changes.

**Investigation next steps:**
1. Reproduce in the playground with mustache. Identify exactly which
   element is "closing" (the variable cards inside the panel? the
   whole right-side panel? the testcase drawer?).
2. React DevTools profiling on each keystroke to find the remount.
3. Trace the unmount back to its key/parent.

**Note:** The FormView focus-loss fix (`a52ca93827`) was pushed to
remote *before* Mahmoud's QA, so this is either an incomplete fix or a
separate path.

---

## 3. 🟢 Mustache form: can't add a second sub-path after the first

**Slack ts:** 1780309942.897139
**No attachment** — text description only

> If I create `{{country.a}}` in mustache, I get a object variable
> mustache with `a` under it, if I then add `{{country.b}}` nothing
> happens, no new thing get created. This would be alright as far as
> either 1) we show objects as jsons directly (and it's clear you can
> edit them) or 2) the form allows adding fields. But right now it
> feels I cannot add that variable manually.

**Likely cause (unverified):** Schema-from-sub-paths derivation issue.

The chain:
- `extractVariablesFromConfig` parses prompt → returns
  `["country.a", "country.b"]`.
- `groupTemplateVariables` deduplicates by `${envelope}.${key}` and
  accumulates sub-paths → `{key: "country", subPaths: ["a", "b"]}`.
- `buildSubPathSchema(["a", "b"])` builds an object schema with both
  fields → seeds `FormView` with `{a: "", b: ""}`.

If the second sub-path isn't surfacing, plausible causes:
- The molecule's `entity.data` updates atomically with each prompt
  edit, but **the testcase data is already filled** with `{a: "..."}`.
  The form merges existing data (no `b`) on top of the seed and loses
  `b` because the new schema isn't reactively applied.
- `FormView` reads its schema once on mount and doesn't react to
  schema changes from sub-path additions.
- `VariableCard`'s `expectedSchema` prop changes but the editor's
  internal state doesn't pick up the new fields.

**Mahmoud's preferred resolutions (either is acceptable):**
- (A) Render objects as JSON directly, clearly editable.
- (B) Form view allows the user to add fields manually.

**Investigation next steps:**
1. Reproduce: open a fresh mustache app, type `{{country.a}}`, fill
   `a`, then add `{{country.b}}` — confirm `b` doesn't appear in form.
2. Inspect `inputPortSchemaMap` and `expectedSchema` propagation in
   the `country` variable card on each prompt edit.
3. Decide between (A) and (B); my lean is (B) since (A) would change
   the default view mode for objects across the board.

---

## 4. 🟢 "Text" and "markdown" swapped in messages view-mode dropdown

**Slack ts:** 1780310000.836319 · video: `F0B7ARBJ7RT`

> Text and markdown are incorrectly swapped for messages

**Investigation so far:** Read all the relevant code paths — they look
correct by inspection:

- `getViewOptions` in `viewTypes.ts:109-111` returns `[{value: "text",
  label: "String"}, {value: "markdown", label: "Markdown"}]` for
  strings. Labels match values.
- `ChatMessageList.tsx:92` initialises `viewMode = "text"`.
- `ChatMessageList.tsx:176` wires `markdownView={viewMode ===
  "markdown"}`. Selecting "Markdown" → `markdownView=true` →
  `SET_MARKDOWN_VIEW` dispatched → editor swaps to markdown source.
- `MarkdownToggleButton.tsx:25-29` shows the OPPOSITE of current
  state as the offered action (standard toggle UX). Not "swapped".

**Hypotheses I can't disambiguate without the video:**
1. The default ("String") actually renders as markdown — meaning the
   underlying `markdownViewAtom` is sticky from a previous session
   and overrides the freshly-mounted dropdown.
2. The labels themselves are inverted somewhere I haven't found
   (unlikely — `VIEW_LABELS` in `ViewTypeSelect.tsx:34-41` matches).
3. The dropdown OPTIONS list renders in reversed order in the chat
   header (some CSS or ordering layer).

**Investigation next steps (deferred):**
1. Launch playground locally with chat app + mustache; observe the
   dropdown's label-to-behaviour mapping live.
2. If 1 isn't tractable, ask Arda/Mahmoud for one screenshot of:
   (a) what the dropdown shows when "Markdown" is selected vs. (b)
   what the editor body actually renders.

**Why deferred:** All code paths I can read look right. Without
reproduction I'd be patching at random.

---

## 5. 🟢 Chat playground shows `messages` as an unused testcase column

**Slack ts:** 1780310117.466549 · video: `F0B88G1HUCQ`

> In chat playground we are showing messages are unused testcase
> columns (although they are actually used in the chat).

**Root cause (CONFIRMED):** Mismatch in chat-mode handling between
`referencedVariableKeysAtomFamily` and `splitInputsVisibility`.

`web/packages/agenta-playground/src/state/execution/selectors.ts:342-343`:

```ts
if (!isChat) return merged
return merged.filter((key) => key !== "messages" && key !== "outputs")
```

In chat mode, `messages` and `outputs` are filtered OUT of
`referencedKeys`. Then `splitInputsVisibility` runs:
- `messages` is in `testcaseData` (chat tests carry messages)
- `messages` is NOT in `referencedKeys`
- Therefore `messages` → `unreferencedColumns` → renders in the
  collapsed footer

But `messages` IS used in chat — implicitly through the chat UI, not
through a `{{messages}}` template token.

**Fix:** Filter `messages` (and `outputs`) out of `testcaseData` too
before calling `splitInputsVisibility`, so it appears in neither the
main inputs list NOR the unreferenced footer. The chat UI is the
canonical surface for the messages field — it shouldn't double-list.

**Files involved:**
- `web/packages/agenta-playground/src/state/execution/selectors.ts`
  (the `playgroundInputsAtomFamily` factory around line 415).

---

## 6. 🟢 [REGRESSION] Chat playground multi-testcase + concatenated messages

**Slack ts:** 1780310340.681079
**No attachment** — text description

> [regression] In that chat playground:
> 1. We are allowing the user to sync multiple testcases to the
>    playground (although that is not possible)
> 2. And then we are loading the messages from the multiple testcases
>    after each other (although that does not make sense)
>
> The right behavior is to allow loading one test case only in the chat.

**Root cause (CONFIRMED):** Two compounding gaps in the new chat seed
flow that the OSS→package migration introduced:

### 6a. `extractAndLoadChatMessagesAtom` accepts a list of rows and
concatenates their messages into a single thread.

`web/packages/agenta-playground/src/state/helpers/extractAndLoadChatMessages.ts:238-263`:

```ts
// Parse messages from each row
const datasetMessages = testcaseRows.map((row) =>
    normalizeMessagesFromField(resolveMessages(row)),
)
const allMessages = datasetMessages.flat()
if (!Array.isArray(allMessages) || allMessages.length === 0) return
// ...
for (const rowMessages of datasetMessages) {
    // ...for each user turn, push user message + assistant responses
}
```

Both the `.flat()` early-exit guard and the outer `for` loop iterate
over every passed row. If `testcaseRows.length > 1` the function emits
all of their messages back-to-back into the single shared
`messageIdsAtomFamily(loadableId)` queue. The flat sequence ends up as
"row 1 user → row 1 assistant → row 2 user → row 2 assistant → …" —
exactly what Mahmoud reported.

### 6b. The connect-to-source path in `playgroundController` doesn't
constrain to a single row in chat mode.

`web/packages/agenta-playground/src/state/controllers/playgroundController.ts:480-495`:

```ts
set(loadableController.actions.disconnect, loadableId)
// ...
for (const row of rows) {
    set(loadableController.actions.addRow, loadableId, row.data ?? {})
}
```

(verbatim from the codebase audit during this triage). In chat mode
this loop should constrain to `rows[0]` only — both because (a) the
chat UI only displays one row (per `generationVariableRowIdsAtom`
which already does `rowIds[0]` in chat mode) and (b) seeding messages
from multiple rows produces the concatenated thread bug in 6a.

### Why this is a regression vs. main

Pre-migration, the legacy OSS-side `LoadTestsetButton` constrained the
chat path to one testcase by construction — it set a single testcase
on the playground row and seeded messages from that one row. The
new `playgroundController.connectToSource` + `extractAndLoadChat
MessagesAtom` path generalised this to accept any number of rows
without re-adding the chat-mode single-row constraint, so the legacy
gate was lost.

**Fix outline:**
1. In `playgroundController.connectToSource`, when `isChat`, slice
   `rows` to `[rows[0]]` before adding rows AND before calling
   `extractAndLoadChatMessagesAtom`.
2. Add a defensive `isChat` check inside
   `extractAndLoadChatMessagesAtom` itself — if it's called with
   multiple rows in chat mode, take the first one and `log.warn` (so
   we catch any other entrypoint that bypasses the gate).
3. Surface a UI constraint: the testset connection picker should
   block multi-select in chat mode (or pick the first selection
   silently).

**Files involved:**
- `web/packages/agenta-playground/src/state/controllers/playgroundController.ts`
  (connect-to-source flow)
- `web/packages/agenta-playground/src/state/helpers/extractAndLoadChatMessages.ts`
  (the message-seeding atom)
- The testset connection picker UI (find later; likely in
  `@agenta/playground-ui` or `@agenta/entity-ui`).

**Owner candidate:** Arda (FE).

---

## 7. 🟢 Autocomplete + frontend mustache features broken — post-merge regression

**Slack ts:** 1780310445.880499
**Playground URL:** [staging.preview.agenta.dev/.../playground](https://staging.preview.agenta.dev/w/019315dc-a34f-7742-bfd4-51b18cf132c9/p/019315dc-a367-7b9d-8491-e1a092f49ddc/apps/0199713c-8dcc-7d01-b282-d2ecf149c513/playground?revisions=0199713c-9142-72f2-80fb-e1c3102e7bc7)

> I will stop here. All autocomplete, etc.. frontend features for
> mustache don't work for me, I guess a regression post-merge. Does
> not make sense to continue QA without it.

**Likely cause (unverified):** "Post-merge regression" — Mahmoud is
explicitly suggesting the regex fix in `17df11cca3 web regex fix` (in
the `TokenPlugin.tsx`, part of the base-branch merge `d9066e6c2f`)
broke autocomplete and other token-related features.

**Investigation next steps:**
1. Diff `17df11cca3` vs the prior `TokenPlugin.tsx` state — what regex
   changed?
2. Test autocomplete in mustache mode in our local worktree (we just
   pulled the merge, so we have the exact state Mahmoud is on).
3. If the regex change is too narrow / too broad, fix it.

**Note:** Solving #7 likely unblocks Mahmoud to resume QA on the
remaining issues. Highest leverage to fix first.

---

## 8. ⚪ Cursor jumps outside `{{...}}` after first character (mustache only)

**Slack ts:** 1780313900.071979 (Kaosiso, 2026-06-01 11:38Z)
**Attachment:** `F0B7CFEJMNJ` (screen recording)

> When using Mustache prompt syntax, typing inside a variable placeholder
> causes the cursor to unexpectedly jump outside the curly braces after
> entering the first character. This issue only occurs with Mustache
> syntax. The same behavior is not observed with Jinja2 or Curly prompt
> syntaxes.

**Relationship to #2:** Kaosiso's description is a cleaner version of
what Mahmoud called "variables keep closing automatically after the
first letter". Same conditions (mustache only, first character),
likely same root cause — caret position is being relocated outside the
token by some re-render in the token plugin.

**Hypothesis:** the `693ac2457e` regex fix (re-include `#`/`^`/`&`
sigils as token-bearing) may already resolve this — before the fix,
`{{x` got promoted to `TokenInputNode`, then typing `}}` produced
`{{x}}` which (depending on the order) might trigger transient
remounting between `TokenInputNode` → `TokenNode` → … and lose caret
position. With the wider regex, that path stabilises.

If still broken post-fix: investigate `TokenPlugin`'s `$transformNode`
caret-restoration logic (around lines 130-145) — when it splits text
nodes to extract a token, it computes a new cursor offset but the
mustache-specific code path may not handle the in-token caret case.

**Investigation next steps:**
1. Reproduce on the post-`693ac2457e` branch. If resolved → close
   both #2 and #8 as duplicates of #7.
2. If still broken: profile each keystroke in React DevTools to find
   the remount, walk the caret-restoration code.

## 9. 🟢 `curly` picker option disappears after switching away in old apps

**Slack ts:** 1780316376.172399 (Kaosiso, 2026-06-01 12:19Z)
**Attachments:** `F0B7ES3EP8A`, `F0B78EZKTV1` (before/after screenshots)

> For old apps, after changing the prompt syntax from `curly` to
> `mustache` or `jinja2`, the `curly` option is removed from the
> dropdown. This means users cannot switch back to `curly`.

**Root cause (high confidence — by reading):** `templateFormatOptions.ts`
in `@agenta/entity-ui` (the picker's option builder) conditionally
includes `curly` and `fstring` ONLY when the current `template_format`
value already matches them — they're hidden from the picker for new
prompts. The intent (per the original PR #4393 design) is:
"`mustache` and `jinja2` for new prompts; legacy `curly` / `fstring`
stay selectable for prompts that already use them, no silent
coercion."

But the gate uses the CURRENT value, not the ORIGINAL value. So:

  - Prompt loads at `curly` → picker shows `[curly, mustache, jinja2]`
  - User picks `mustache` → value becomes `mustache`
  - Picker rebuilds → no longer shows `curly` (current value isn't `curly`)
  - User now stuck on `mustache`/`jinja2`, can't go back

**Fix outline:** track the ORIGINAL `template_format` (the one stored
when the prompt was loaded) and include it in the picker options
regardless of the current value, so users can revert their choice
within the same session.

Implementation locations:
- `@agenta/entity-ui/template-format/templateFormatOptions.ts`
  (or wherever `buildTemplateFormatOptions` lives) — accept an
  `originalFormat` param alongside `currentFormat`.
- Caller in `PromptSchemaControl` — pass `originalFormat` derived
  from the loaded prompt's first-seen `template_format`.

Scope: ~30-50 lines net, plus a unit test pinning the "originally
curly → curly stays selectable after switching" behaviour.

---

## Strategy

Per Arda (2026-06-01): **fix all seven before declaring QA unblocked**.
Mahmoud's "I'll stop here" message is acknowledged but not a reason to
ship #7 in isolation — we'd just be inviting another partial QA pass.

## Working order (confidence + adjacency, not unblock-first)

1. **#5 + #6** — chat regression cluster. Both have confirmed root
   causes, adjacent files (`selectors.ts`, `extractAndLoadChat
   Messages.ts`, `playgroundController.ts`). Highest user-impact
   (data displays nonsensically). Tackle together so the chat-mode
   semantics stay coherent across the seed flow.
2. **#4** — small mapping fix in `view-types`. Low architectural
   risk; verify by reading the video carefully then patching.
3. **#7** — verify the `17df11cca3 web regex fix` actually broke
   autocomplete. If yes, fix; if no, dig deeper into the merge diff
   for the true cause.
4. **#3** — needs reproduction. ~30-60 min of repro before fix.
   Likely a schema-from-subPaths reactivity issue.
5. **#2** — needs reproduction. The FormView focus-loss fix
   (`a52ca93827`) didn't cover this — different surface.
6. **#1** — backend territory. Last because FE side likely can't fix
   alone; pass to JP with evidence (trace_id from a real call + the
   absence in the traces store).

Each fix lands as its own commit on `fe-feat/mustache-support`. No
single mega-commit. Tests where the bug is reproducible at unit level
(chat seed, visibility split, view-type mapping); manual verification
otherwise.
