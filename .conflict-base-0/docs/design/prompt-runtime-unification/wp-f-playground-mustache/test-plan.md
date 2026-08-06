# Manual QA — Playground Mustache + Native JSON + V2 Input UX

This branch ships:

- **Backend** (from #4393): mustache rendering, `{{$...}}` JSONPath, frontend `template_format` widening across the editor / chat-message / schema-control surfaces, `vitest` runner in `@agenta/entity-ui`, mustache as the default for new `*_v0` workflow interfaces.
- **Frontend (this branch)**: native-JSON transport surgery in `buildEvaluatorExecutionInputs`, V2-aligned playground input cards (`PlaygroundInputsBody`) behind a feature flag, referenced/draft/unreferenced visibility rule (`playgroundInputsAtomFamily`), playground `TemplateFormatPicker` component.

This document gives you the fixtures + prompts + scenarios needed to exercise every improvement end-to-end.

## 0. Prerequisites

### Branch + worktree

You're already on `fe-feat/mustache-support` at `.claude/worktrees/fe-feat-mustache-support/`. Confirm:

```bash
cd .claude/worktrees/fe-feat-mustache-support
git branch --show-current
# fe-feat/mustache-support
git log --oneline -3
# Should show: ba5fa4c7b chore(frontend): reconcile post-merge ...
#              5483ec07e Merge ... feat/add-mustache-rendering ...
```

### Local stack

Spin up the standard Agenta dev stack from the worktree:

```bash
# From the worktree root
docker compose -f hosting/docker-compose.dev.yml up
# OR whatever your usual local-dev start command is
```

Then run the web dev server pointed at this worktree:

```bash
cd web/oss
pnpm dev
# Open http://localhost:3000
```

### Enable the V2 input UX feature flag

The new `PlaygroundInputsBody` rendering is OFF by default (`useNewPlaygroundInputsBodyAtom = false`). To turn it on for QA, you have three options:

**Option A — temporary code change (recommended for a QA session):**

Edit `web/packages/agenta-playground-ui/src/state/featureFlags.ts`:

```diff
- export const useNewPlaygroundInputsBodyAtom = atom<boolean>(false)
+ export const useNewPlaygroundInputsBodyAtom = atom<boolean>(true)
```

Revert before pushing. The default-flip is an explicit follow-up commit per the design doc.

**Option B — runtime flip via React DevTools:**

Open React DevTools → find any component subscribed to `useNewPlaygroundInputsBodyAtom` → use the Jotai DevTools panel to set it `true`.

**Option C — runtime flip via console:**

Skip C if you don't already expose the Jotai store globally.

---

## 1. Upload the testset

The fixture lives at `docs/design/prompt-runtime-unification/wp-f-playground-mustache/testset.json` (same folder as this doc).

It contains 3 rows (Vanuatu / Kiribati / Switzerland) with deliberately varied column types:

| Column | Type | Purpose |
|---|---|---|
| `country` | string | plain `{{name}}` mustache substitution |
| `population_thousands` | number | type-chip → `NUMBER`; native-number transport |
| `is_island_nation` | boolean | type-chip → `BOOLEAN`; Switch widget in text mode |
| `geo` | object (nested 2 levels) | mustache `{{geo.region}}` + `{{geo.coordinates.lat}}` — the headline test |
| `languages` | array of strings | Form view; mustache section iteration `{{#languages}}…{{/languages}}` |
| `metadata` | **string that contains JSON** | gap-04: must STAY a string, not be parsed |
| `messages` | array of role-tagged objects | Chat view; tests `ChatMessageList` integration |
| `correct_answer` | string | optional ground-truth column for the evaluator scenario |
| `notes` | string | **unused by default** — exercises the unreferenced-columns footer |

### Upload steps

1. In the Agenta web UI, go to **Testsets**.
2. Click **Create new testset** → **Upload file**.
3. Choose the `testset.json` file from the path above.
4. Optional: rename to something like `Mustache QA`.
5. Click **Upload**.
6. Confirm: row count = 3, columns include `country`, `geo`, `messages`, `metadata`, etc.

**Sanity check — gap-04 in the testset editor:**

- Open the testset → open the Vanuatu row in the drawer.
- `metadata` should show as type chip **`STRING`** (NOT `OBJECT`), even though its value looks like JSON. If the chip says `STRING`, gap-04 is alive end-to-end on the testset side.
- `geo` should show as **`OBJECT`** with nested `region` / `subregion` / `coordinates` rows.
- `messages` should show as **`MESSAGES`** (or render with the chat editor).

---

## 2. Create the test app (completion-mode mustache)

The simplest exerciser is a custom completion app whose prompt uses mustache. Newly created apps now default `template_format: "mustache"` (WP-B3 in `*_v0` interfaces).

1. Go to **Apps** → **Create new app** → **From template** → pick a completion-mode template (e.g. `completion`).
2. Name it `Mustache QA — completion`.
3. Open the new app in the playground.

### Verify template_format defaults

Open the variant config panel (the prompt config side, **not** the generations side). Either:

- Look at the `parameters.prompt.template_format` field, OR
- Open the drawer (focus a prompt) — the new `template_format` dropdown (shipped by #4393's `PromptSchemaControl`) should show **"Prompt Syntax: Mustache"** selected.

If the dropdown shows curly/jinja2/fstring instead, you're on an existing app that pre-dates the WP-B3 default flip. Either accept that (it works fine, just not mustache) or create a brand-new app.

### Attach the testset

1. In the playground, **Generations** panel → **Load testset** → pick `Mustache QA`.
2. You should see one card per testset row (Vanuatu / Kiribati / Switzerland).

---

## 3. Scenarios

Each scenario lists: the prompt to paste, what to verify, and how to verify.

### A — Mustache rendering (from #4393)

These exercise WP-B3's backend renderer + the `extractTemplateVariables` widening shipped by #4393.

#### A1 — Plain variable substitution

**Prompt** (paste into the prompt editor's user/system message):

```
The country in scope is {{country}}.
```

- Run against the Vanuatu testcase.
- **Expected rendered prompt at the backend:** `"The country in scope is Vanuatu."`
- Verify via: the response trace (look at the rendered prompt input the LLM saw).

#### A2 — Nested object access (the headline mustache feature)

**Prompt:**

```
{{country}} is in the {{geo.region}} region, specifically {{geo.subregion}}.
```

- Run against Vanuatu.
- **Expected:** `"Vanuatu is in the Pacific Islands region, specifically Western Melanesia."`
- This is the test that should have FAILED before this branch (transport stringified `geo`, so the renderer received `"{\"region\":\"...\"}"` and `geo.region` resolved to nothing). It must pass now.

#### A3 — Deep nested access

**Prompt:**

```
{{country}} sits at coordinates lat={{geo.coordinates.lat}}, lng={{geo.coordinates.lng}}.
```

- Run against Vanuatu.
- **Expected:** `"Vanuatu sits at coordinates lat=-15.376, lng=166.959."`

#### A4 — Whole-object insertion (compact JSON)

**Prompt:**

```
Full geo info: {{geo}}.
```

- Run against Vanuatu.
- **Expected rendered:** `Full geo info: {"region":"Pacific Islands","subregion":"Western Melanesia","coordinates":{"lat":-15.376,"lng":166.959}}.`
- Per RFC: whole-object insertion renders as compact JSON.

#### A5 — JSONPath escape hatch

**Prompt:**

```
Region (via JSONPath): {{$.geo.region}}.
First language: {{$.languages[0]}}.
```

- Run against Vanuatu.
- **Expected:** `Region (via JSONPath): Pacific Islands. First language: en.`
- `{{$...}}` is pre-rendered before the mustache pass; values are substituted as inert text.
- Per the RFC, the JSONPath root can be a testcase top-level column (keys are spread into the render context). The editor accepts `{{$.geo.region}}` as well as `{{$.inputs.geo.region}}` — both resolve at runtime. The validator only flags actual typos of envelope slot names (e.g. `$.input.country` → suggests `inputs`).

#### A6 — Mustache section iteration

**Prompt:**

```
Languages: {{#languages}}{{.}} {{/languages}}
```

- Run against Vanuatu.
- **Expected:** `Languages: en bi fr ` (trailing space before the closing).

#### A7 — gap-04: JSON-shaped string stays a string

**Prompt:**

```
Raw metadata: {{metadata}}.
```

- Run against Vanuatu.
- **Expected:** `Raw metadata: {"source":"trace","trace_id":"vu-001","latency_ms":520,"confidence":"high"}.`
- The value is INSERTED AS A STRING — not parsed and re-stringified. If you try `{{metadata.source}}` (next scenario), it should NOT resolve.

#### A8 — Negative test: dotted access on a string

**Prompt:**

```
Source field: {{metadata.source}}.
```

- Run against Vanuatu.
- **Expected:** an unresolved-variable error (or empty substitution) — `metadata` is a string, not an object; mustache's dotted-name traversal can't pierce a string. The runtime should treat this as an unresolved tag and surface a clean error.

### B — Native JSON transport (from this branch, Step 1)

Verifies `buildEvaluatorExecutionInputs` passes native types through to evaluators.

#### B1 — Inspect the evaluator request body

1. Open the playground for an evaluator-equipped variant (or set up an evaluator chain — see §4).
2. Open browser DevTools → **Network** tab.
3. Trigger a run on Vanuatu.
4. Find the request to the evaluator endpoint (look for `/services/evaluators/` or similar).
5. Inspect the **request body** → `inputs` field.

**Expected:**

```json
{
    "inputs": {
        "geo": {
            "region": "Pacific Islands",
            "subregion": "Western Melanesia",
            "coordinates": {"lat": -15.376, "lng": 166.959}
        },
        "languages": ["en", "bi", "fr"],
        "metadata": "{\"source\":\"trace\",...}",
        "country": "Vanuatu",
        ...
    }
}
```

**Critical:** `inputs.geo` is a JSON OBJECT (not a string `"{\"region\":\"Pacific Islands\",...}"`). `inputs.languages` is a JSON ARRAY (not a string `"[\"en\",\"bi\",\"fr\"]"`). `inputs.metadata` IS a string (gap-04 invariant — preserves user intent).

#### B2 — Mustache-aware evaluator

If you have an LLM-as-a-judge evaluator wired into the chain, set its prompt to:

```
Your task: check whether the model's answer mentions the {{geo.region}} region.
Model answer: {{prediction}}.
Expected capital: {{correct_answer}}.
Reply YES or NO.
```

Set `template_format: "mustache"` and `correct_answer_key: "correct_answer"` on the evaluator.

- Run against Vanuatu.
- **Expected:** evaluator receives `inputs.geo` as a native object (verified in B1), then mustache resolves `{{geo.region}}` to `"Pacific Islands"`. Before this branch, `geo` arrived as a string and the dotted access failed.

### C — V2 input UX (feature-flag on)

Make sure the feature flag is ON (per §0). Reload the playground.

#### C1 — Bordered cards per variable

- Open a generation card on the Vanuatu testcase.
- **Expected:** each variable is a bordered card with a header (variable name + type chip + "View as ▾" dropdown) and a body (the editor).

#### C2 — Type chip vocabulary

For Vanuatu, you should see chips like:

| Variable | Chip |
|---|---|
| `country` | `STRING` |
| `population_thousands` | `NUMBER` |
| `is_island_nation` | `BOOLEAN` |
| `geo` | `OBJECT` |
| `languages` | `ARRAY` |
| `metadata` | `STRING` (gap-04 — even though it looks like JSON) |
| `messages` | `MESSAGES` (chat-detected) |

#### C3 — View-as dropdown options

Click "View as ▾" on each variable. Confirm the options scale to its kind:

| Variable kind | Options offered | Default |
|---|---|---|
| string (`country`, `metadata`) | Text, Markdown, JSON, YAML | Text |
| boolean (`is_island_nation`) | Text, JSON, YAML | Text |
| object (`geo`) | Form, JSON, YAML | Form |
| array (`languages`) | Form, JSON, YAML | Form |
| chat (`messages`) | Chat, JSON, YAML | Chat |

#### C4 — Form mode (object)

- `geo`'s default view is Form.
- **Expected:** nested fields render inline with their own type chips — `region STRING`, `subregion STRING`, `coordinates OBJECT` → `lat NUMBER`, `lng NUMBER`.
- The 2-level nesting should indent behind a left rail.

#### C5 — Chat mode (messages)

- `messages`'s default view is Chat.
- **Expected:** `ChatMessageList` renders with one message per array entry, each with role + content.

#### C6 — JSON view round-trip

- Switch `geo` to **JSON** view.
- **Expected:** code editor with pretty-printed JSON (2-space indent, syntax highlight).
- Edit the JSON (e.g. change `region` to `"Oceania"`) → tab out / blur.
- Re-open the variable in the drawer (or switch back to Form view).
- **Expected:** the edit persisted natively (geo.region is now `"Oceania"`).

#### C7 — YAML view round-trip

- Switch `geo` to **YAML** view.
- **Expected:** YAML dump with `region:`, `subregion:`, nested `coordinates:`.
- Edit the YAML → tab out.
- **Expected:** parses on edit, stores native value.

#### C8 — gap-04 in the playground

- Open `metadata`'s "View as ▾" → switch to **JSON** view.
- **Expected:** the editor shows the JSON inside the string, pretty-printed (because `valueToDisplay(...)`'s json mode attempts `JSON.parse(value)` for strings).
- Make a small edit (change `confidence` to `"medium"`).
- **Expected:** on blur, the value is STILL stored as a string (not parsed and stored as an object). Switch back to Text view to confirm — the value is the raw string text. Type chip stays `STRING`.

### D — Visibility rule

#### D1 — Draft variable (referenced + not on testcase)

- In the prompt editor, add a reference to a variable that doesn't exist on the testcase, e.g. `{{iso_code}}`.
- **Expected:** a new variable card appears in the generations panel with:
  - Name: `iso_code`
  - Type chip: ambiguous / inferred from undefined → likely `STRING` chip (default)
  - A small `draft` text tag in the header
  - Empty body (no value yet)

#### D2 — Draft persistence

- Type a value into the draft card (e.g. `"VU"`).
- Click **Run**.
- **Expected:** the testcase now carries `iso_code: "VU"`. Reload the page; the `iso_code` column persists on the Vanuatu row.

#### D3 — Unreferenced columns footer

- If your prompt does NOT reference `notes`, you should see a footer below all variable cards:
  > **▶ 1 unused testcase column hidden because the prompt does not reference them.**
- Click the footer to expand.
- **Expected:** a collapsed card for `notes` appears below.
- If the count is different (e.g. you removed other references), the count updates live as you edit the prompt.

#### D4 — Referenced ↔ unreferenced transition

- Add `{{notes}}` to the prompt.
- **Expected:** the `notes` card moves from the footer (unreferenced) up to the expanded cards (referenced). Footer count drops to 0 (footer disappears).
- Remove `{{notes}}` from the prompt.
- **Expected:** `notes` moves back to the unreferenced footer.

### E — End-to-end mustache + native JSON

The full integration test — the user-visible win for this whole branch.

**Prompt:**

```
You are a geography research assistant.

The country in scope is {{country}}. Its region is {{geo.region}}, subregion is {{geo.subregion}}.
Population is {{population_thousands}} thousand. The country speaks: {{#languages}}{{.}} {{/languages}}.

Coordinates: lat {{geo.coordinates.lat}}, lng {{geo.coordinates.lng}}.

Reply with a one-sentence answer to the most recent user question.
```

1. Confirm `template_format: "mustache"` on the variant (see §2).
2. Set `messages` (or pass `messages` from testcase) as the chat history.
3. Run against Vanuatu.

**Expected (rendered prompt seen by the LLM):**

```
You are a geography research assistant.

The country in scope is Vanuatu. Its region is Pacific Islands, subregion is Western Melanesia.
Population is 320 thousand. The country speaks: en bi fr .

Coordinates: lat -15.376, lng 166.959.

Reply with a one-sentence answer to the most recent user question.
```

(Plus the `messages` array tacked on by chat mode.)

**The model's response** should answer the most recent user message — for Vanuatu, "What is the capital of Vanuatu and its ISO 3166-1 alpha-2 code?" → expected response: something like "Port Vila (VU)".

If the rendered prompt has bare `{{country}}` / `{{geo.region}}` placeholders (not substituted), template_format is wrong or transport is broken.
If `geo.region` resolves to an empty string, transport is broken (geo arrived as a stringified `"{...}"`, mustache dotted access can't pierce it).

---

## 4. Optional — Evaluator chain setup (for B2 + advanced transport tests)

Quick recipe to add an LLM-as-a-judge evaluator on top of the test app:

1. In the playground, **Add** → **Evaluator** → pick `auto_ai_critique` (or `auto_ai_critique_v0`).
2. Wire its inputs:
   - `prediction` ← upstream app output
   - `correct_answer_key` setting = `"correct_answer"` (so `inputs.correct_answer` resolves from the testcase)
3. Evaluator prompt template (mustache):
   ```
   Question: {{messages}}
   Expected answer (region context: {{geo.region}}): {{correct_answer}}
   Model answer: {{prediction}}
   Score: 1 if the model's answer mentions the expected capital, 0 otherwise.
   ```
4. Run against Vanuatu.

**Critical verification (B1 redux):** check the evaluator's request body. `inputs.geo` must arrive as native object. If it's a stringified JSON, the transport surgery regressed.

---

## 5. Regression checks (existing apps)

These ensure we didn't break anything that worked before.

### R1 — Legacy curly app

- Open any pre-existing app whose `template_format` is `curly`.
- Confirm the picker (in the drawer) shows **Curly** as selected with a "legacy" hint badge.
- Run the existing test cases.
- **Expected:** no behavior change. Curly's literal-key-first lookup still works.

### R2 — Legacy fstring app

- Same as R1 but for `fstring`.

### R3 — Feature flag OFF

- Set `useNewPlaygroundInputsBodyAtom` back to `false` (revert the temp edit, or flip via devtools).
- Reload the playground.
- **Expected:** the playground falls back to the old `VariableControlAdapter` rendering (borderless per-variable cells, no type chips, no "View as ▾"). No regression.

---

## 6. What's NOT tested by this plan (deferred follow-ups)

- **ComparisonLayout** — multi-variant side-by-side view still uses `VariableControlAdapter`. Same swap pattern applies; deferred per design doc.
- **Grouped evaluator layout** — `useGroupedLayout === true` branch (evaluator with extracted field ports under envelope sections) still uses `VariableControlAdapter`.
- **TemplateFormatPicker placement in the playground** — the component is built but not yet placed in a specific OSS prompt-config surface (Open Q2 — needs design-team sign-off). The drawer's picker (from #4393) IS testable.
- **Default-flip of the feature flag** — small follow-up commit after you sign off the new UX.

---

## 7. Quick "did everything pass?" checklist

- [ ] **A1-A6** mustache scenarios all return correctly rendered prompts at the LLM.
- [ ] **A7** `metadata` string is inserted as-is (not parsed).
- [ ] **A8** `{{metadata.source}}` fails with a clear unresolved-variable error.
- [ ] **B1** Network tab shows `inputs.geo` as a native object (not a string).
- [ ] **B2** Mustache-aware evaluator works against the native-JSON inputs.
- [ ] **C1-C5** Each variable type renders with the right chip + view-as options.
- [ ] **C6-C7** JSON ↔ YAML edit round-trips preserve native types.
- [ ] **C8** gap-04 holds: `metadata` stays a STRING even after JSON-view edits.
- [ ] **D1-D2** Draft variables show + persist correctly.
- [ ] **D3-D4** Unreferenced footer updates live as the prompt changes.
- [ ] **E** End-to-end mustache + native JSON renders the expected prompt text.
- [ ] **R1-R3** Legacy formats + feature-flag-off paths unchanged.

If all of the above pass, this branch is good to ship.
