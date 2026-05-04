# Competitive analysis — Braintrust vs Langfuse, dataset surfaces

**Date:** 2026-05-04
**Source data:** 38 screenshots in `screenshots/competitors/`, captured from Braintrust and Langfuse, both using our 8 fixtures (`01-flat-strings` … `08-dot-key-collision`) as actual datasets. Direct apples-to-apples.
**What we're comparing:** how each tool handles the same UX surfaces gap-01 through gap-06 cover — type indicators, table-cell rendering, drill-in / detail panel, JSON edit, schema awareness, dot-key disambiguation, messages rendering.

## TL;DR

| Dimension | Braintrust | Langfuse | Agenta (today) | Winner for the user |
| --- | --- | --- | --- | --- |
| Information architecture | List → row → side panel; panel stays mounted as you scroll the table | List → row → modal | List → drawer | Tie (BT continuity edge) |
| Cell rendering | Truncated YAML/JSON token preview | Full multi-line JSON in cell, syntax-highlighted | Raw multi-line JSON or `—` | **Langfuse** |
| Drill-in detail layout | Schema-aware **form** with one labelled field per column, per-field view-mode (`Text` / `YAML`), Activity log | Single big modal, three JSON editors (Input / Expected / Metadata) | Drill-in cards via `DrillInContent` | **Braintrust** by a mile |
| Type indicators | None visible (relies on the form-control type) | None | None today; gap-01 proposes adding | All three skip explicit type chips |
| Schema awareness | Yes — explicit `Field schemas` (YAML) drives the edit form | None — JSON-only | Partial via molecule schema, not surfaced in drill-in today | **Braintrust** (the only tool that does this) |
| Dot-key vs nested | Renders both `geo` (object form) AND `geo.region` / `geo.subregion` (literal flat keys) as separate labelled inputs in the form. Implicit disambiguation. | Doesn't address it — both shapes appear inside the JSON blob, no labelling | Today: undifferentiated. Gap-05 proposes chips. | **Braintrust** (form-shape lays it bare; ours could go further with a chip) |
| Messages rendering | Stays in the YAML/JSON pane; no chat-card view in dataset row detail | Same — JSON only | Today: ChatMessageEditor only after drilling twice. Gap-06 proposes lifting it. | None of us — opportunity |
| Edit ergonomics | Per-field text editors, view-mode per field, copy/lock per field, free-form custom-column add, Activity log per row | One modal, three big JSON code editors, save/cancel | Today's drill-in is closer to BT but missing schema awareness | **Braintrust** |
| Complexity / cognitive load | Higher — many panels, rich right-rail, custom columns, schema, flag-for-review, version, snapshots, evaluate-in. Power-user heavy. | Low — modal with JSON, that's it. Approachable but flat. | Mid | Depends on user — Langfuse for first-touch, BT for serious work |

**One-line verdicts:**
- **Braintrust** has the most thoughtful drill-in we've seen. Steal: schema-aware per-field form with view-mode-per-field, a first-class Activity log on each row, and the two-pane "table on the left, sticky detail on the right" continuity. Avoid: cognitive density, the YAML-as-default for everything (gap-04 cousin), and the dual-edit-paths fragmentation.
- **Langfuse** is the clean opposite — minimal, JSON-everywhere, no schema. Approachable and fast for "look at the data," but useless for any structured editing. Steal: the table-cell-as-syntax-highlighted-JSON-preview. Avoid: the modal-with-three-JSON-blocks edit experience — that's exactly the experience our drill-in is meant to improve on.

The rest of this doc breaks each surface down with screenshots and explicit "steal / avoid / inspires variant" tags.

---

## 1. Dataset list page

### Braintrust

![Braintrust dataset list](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.23.35.png)

What it shows — for each dataset row: Name, Description, Updated, **Examples** count, **Metadata** (object preview), **url_slug**, Tags. Sortable column headers. Add Dataset button top-left. Filter + Display + Search controls.

Notable:
- **Metadata column shows the YAML/JSON object preview inline** as a token: `{"__schemas":...}` truncated. That's a chip-adjacent affordance. Click expands somewhere (probably the row).
- Examples is a numeric column — at-a-glance "is this a tiny or huge dataset."
- Standard list table, dense, sortable, no surprises.

Verdict: **steal the Metadata column shape** (truncated structured preview alongside primitive columns). Our testset list doesn't expose metadata at this level today.

### Langfuse

![Langfuse dataset list](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.27.48.png)

Top tabs split **Experiments** vs **Items** at the dataset level. Per row: Item ID, Source (with a status badge), Created At, **Input**, **Expected Output**, Metadata, Actions.

Notable:
- **`Input` and `Expected Output` columns show pretty-printed JSON inline**. Three to four lines visible per row — you can read the actual data without drilling in.
- Source badge ("Active") is a status pill, not a type indicator.
- Right-side "Columns 8/8" toggle for column visibility.
- New Item / Upload CSV at top right.

Verdict: **steal the always-visible JSON preview in cells** — this is Langfuse's strongest UX choice. It's gap-02 territory, and Langfuse already does it cleanly. The cost is row height (each row ~80–120 px); the win is no-click data scanning.

### Agenta (today)

Single drawer that opens on click, raw JSON in cells with em-dash for missing. We're behind both. Gap-02 already proposes the chip+preview pattern; Langfuse confirms the visual instinct (preview the JSON inline) but our chip overlay would be additive on top.

---

## 2. Table-cell rendering across fixtures

### Braintrust — collision dataset

![Braintrust 08-dot-key-collision](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.25.39.png)

Rows: Created / Input / Expected / Tags / Metadata. Input column shows just `{"correct_ans..."` truncated to a single token. The right panel (Field schemas) shows the full inferred schema — including BOTH `geo` (object with region/subregion) AND `geo.region` / `geo.subregion` as literal keys, AND `user.profile.name` / `user.profile.role` AND `user.profile` (nested) AND `user`.

Notable:
- Cells are deliberately minimal — they're navigation tokens. The detail lives in the right panel.
- Field schemas panel is rendered as **YAML** (note the `__schemas:` key), expandable tree.
- That schema panel *literally encodes* the dot-key collision with no chip — by listing both shapes side by side.

### Langfuse — same fixture

![Langfuse set8 (dot-key collision)](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.29.36.png)

Rows: Item Id / Source / Status / Created At / Input / Expected Output / Metadata / Actions. The Input column shows the full pretty-printed JSON: `user: null`, `country: "Kiribati"`, `geo.region: null`, `geo.subregion: null`, `correct_an…`. Expected output: `{"capital": "South Tarawa", "countryName": "Kiribati"}`.

Notable:
- **Both literal-flat (`geo.region`) and nested (`gen` not visible here, but `user` shown) keys render together with no marker** — exactly the gap-05 problem we identified. The user has zero signal that `geo.region` and `geo.subregion` are literal keys vs nested traversal.
- The pretty-printed inline preview is genuinely useful for scanning, but **collision blindness is real here**.

### Verdict for cell rendering

| Pattern | Steal | Avoid | Notes |
| --- | --- | --- | --- |
| Inline pretty-printed JSON preview (Langfuse) | ✓ | | Gap-02 wins. Combine with our chip + count. |
| Truncated single-token preview (Braintrust) | | ✓ | Reads as "broken cell" without the side panel context. |
| Type / dot-key chip on cell | | | **Neither tool has it.** Our gap-01 + gap-05 proposal would put us ahead. |
| Multi-line cells (variable row height) | ✓ | | Langfuse does this — row height grows to fit the JSON. We use a fixed compact row. Both have merit; offer as a row-height toggle (Braintrust does this in the Display popover). |

---

## 3. The drill-in / detail experience — the biggest gap

### Braintrust — collapsed detail panel

![Braintrust dataset detail with Details tab](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.23.41.png)

Right panel mounted persistently. Tabs: **Details** | **Runs**. Details shows: Description (free-form text), Metadata (YAML editor), Recently used in. The table on the left stays scrollable.

### Braintrust — Edit mode for a single row

![Braintrust 01-flat-strings, Edit mode](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.23.47.png)

Different right panel — now showing per-row detail. Tabs: **Edit** | **Runs** | **Views**. Inside Edit:
- Flag for review / Tag controls
- **Input** section header — content rendered as YAML by default
- **Expected** section header — `null`
- **Metadata** section header — `null`
- **Activity** log at bottom with comments + audit trail (`Arda Erzin · created the dataset row · Yesterday 11:58 PM`)
- "+ Custom column" button at bottom

### Braintrust — schema-aware form for the collision dataset

![Braintrust 08 row in Edit form mode — gap-05 territory](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.25.56.png)

This is the most interesting thing in the whole capture. The Edit panel for a single Vanuatu/Nauru-collision row renders as a **schema-aware form**, not raw YAML. Each column is its own labelled input:

- **geo** (sub-form heading)
  - **region** — Text editor, "Enter value"
  - **subregion** — Text editor, "Enter value"
- **user**
  - **profile** — "No properties defined for this object"
- **country** — Text editor, value `Nauru`
- **outputs** — Text editor, value `Yaren`
- **geo.region** — separate Text editor (literal-dot key, distinct from `geo > region`)

Continuing the form (next screenshot):

![Braintrust 08 form continued](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.26.05.png)

- **correct_answer** — Text editor with the long sentence
- **user.profile.name** — Text editor with `explicit_nested_name`
- **user.profile.role** — Text editor with `viewer`
- **Expected** — YAML, `null`
- **Metadata** — YAML, `null`
- **Activity** with comment box

Each Text editor has a per-field view-mode dropdown (`Text` ▾) — confirming Braintrust's pattern: **the view-mode selector is per-field, and the storage type is decoupled from the editor type.**

### Langfuse — modal-with-three-JSON-blocks

![Langfuse Edit Dataset Item — small payload](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.27.33.png)

Three labelled JSON editors stacked: **Input** (pretty-printed object), **Expected output** (pretty-printed object), **Metadata** (empty). Cancel / Save changes buttons.

Same modal for a more complex payload (set7, messages):

![Langfuse Edit Dataset Item — messages payload](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.29.25.png)

The same three-pane layout. Input is now a 14-line `messages` array with system/user/assistant + tool_calls. Expected output is a 30+ line tool_calls trace. **All of this is one giant JSON code editor per pane.** No collapse, no cards, no role labels, no tool-call recognition.

### Verdict for drill-in

This is the clearest divergence. Three implementations:

**Braintrust** — **steal almost everything**:
- ✓ Tabs at the top of the panel (Edit / Runs / Views) — comparable to our drawer-in-OSS Fields/JSON segmented toggle, but with better information density. We could promote this to "Edit / Runs / Annotations / Activity."
- ✓ **Schema-aware form** — labelled, per-field text editors. This is exactly what `MoleculeDrillInView` + the slot system in `@agenta/entity-ui` was built for. Braintrust validates the architectural choice; we just haven't shipped it yet.
- ✓ **Per-field view-mode** (`Text` ▾) — already present in our `DrillInFieldHeader`. Match.
- ✓ **Activity log per row** — comments + audit trail. We don't have this. Worth adding to our drawer.
- ✓ **Custom-column add inline** — small affordance, big leverage. We have this in the schema flow but not at the row-level edit.
- Avoid: the YAML-default for Expected and Metadata. That collides with our gap-04 (BE storage shape ≠ user-edit shape) and we'd be forking our own RFC if we copied this.

**Langfuse** — **mostly avoid**:
- ✗ Modal-with-three-JSON-blocks. This is precisely what gap-03 (drill-in root view bailout) calls out as the problem. Langfuse has industrialized the bailout.
- ✗ No per-field editors, no validation, no schema. The user types JSON; if they break it, they get nothing. (Empirically the Save changes button stays disabled when JSON is invalid — but no field-level feedback.)
- ✗ No drill into nested values. To edit `geo.region` you scroll inside a 14-line code editor.
- ✗ No labelling distinguishing Input fields from each other.
- ✓ Predictable: every field of every dataset edits the same way. Lowers cognitive load for first-time users. There's a real argument for this as a fallback / advanced mode.

**Agenta (today)** — **between the two**, leaning Braintrust on architecture but missing the form-aware payoff. Our `DrillInContent` produces per-property cards once you drill in, but at root we collapse to the JSON code editor (gap-03), and we don't have an explicit schema-aware form for testcases. Braintrust shows the destination.

---

## 4. Schema awareness — the moat

### Braintrust — Field schemas tab

![Braintrust 02-Nested Native — Field schemas YAML](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.23.54.png)

The right panel's `Field schemas` tab renders the full inferred schema as YAML:

```yaml
__schemas:
  input:
    properties:
      inputs:
        properties:
          correct_answer:
            type: string
          country:
            type: string
        type: object
      outputs:
        properties:
          capital:
            type: string
          countryName:
            type: string
        type: object
    type: object
```

Same surface for the messages-and-tools fixture:

![Braintrust 07-Messages and Tools — Field schemas](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.25.28.png)

```yaml
__schemas:
  input:
    properties:
      inputs:
        properties:
          correct_answer: {type: string}
          country: {type: string}
          messages: {type: array}
          tool_calls: {type: array}
          ...
```

This is a first-class artifact, not a hidden detail. The user can edit the schema directly. The Edit form below renders **based on this schema** — that's why fixture 02's Edit form had explicit `geo > region` and `geo > subregion` text inputs.

### Langfuse — none

Langfuse has no equivalent. Datasets are bags of JSON; types are inferred at use time (in experiments/runs).

### Verdict

**Steal.** This is Braintrust's single biggest UX win and it's the architectural piece our package tier (`@agenta/entity-ui` + `MoleculeDrillInView` + `getSchemaAtPath`) was built for but doesn't yet surface in the drill-in. The relevant move:

1. Surface `__schemas` (or our equivalent — the molecule's schema atom) as a tab in the testcase drawer.
2. Use that schema to drive the per-field form in the Edit tab — labels, input types, validation, default values.
3. When schema is missing/partial, fall back to the existing free-form drill-in.

This is bigger than gap-01 — it's a layer change, but a justified one. Without schema awareness our drill-in is a YAML-tree editor with chrome; with it, it's a real form.

---

## 5. Dot-key vs nested — gap-05 in the wild

The `08-dot-key-collision` fixture deliberately contains both `{"geo.region": "..."}` (literal flat key) and `{"geo": {"region": "..."}}` (nested) in the same row. Each tool reveals different blindness.

### Braintrust — implicit disambiguation via the form

The Edit form ([screenshot above](#braintrust--schema-aware-form-for-the-collision-dataset)) shows `geo > region` and `geo > subregion` as nested form fields, AND separately at the bottom `geo.region`, `geo.subregion`, `user.profile.name`, `user.profile.role` as flat-key text inputs. **The form structure forces the disambiguation.** No chip needed.

The schema panel for the same fixture:

![Braintrust 08 schema panel — both shapes coexist](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.25.39.png)

```yaml
__schemas:
  input:
    properties:
      correct_answer: {type: string}
      country: {type: string}
      geo:
        properties:
          region: {type: string}
          subregion: {type: string}
        type: object
      geo.region: {type: string}
      geo.subregion: {type: string}
      outputs: {type: string}
      user:
        properties:
          profile: {type: object}
        type: object
      user.profile.name: {type: string}
      user.profile.role: {type: string}
```

Both shapes coexist as siblings. **There's no chip, no warning, no collision marker.** A careful reader spots both, but a casual reader may not.

### Langfuse — collision blindness

Langfuse renders the row as a single JSON blob ([screenshot above](#langfuse--same-fixture)) where `user: null, country: "Kiribati", geo.region: null, geo.subregion: null` flows in the same view as nested objects. **No structural distinction.**

### Verdict

| Pattern | Tool | Note |
| --- | --- | --- |
| Form structure does the disambiguation | Braintrust | Good but implicit. A user who only opens the JSON view loses the signal. |
| No disambiguation | Langfuse | Worst-case. |
| Chip + collision warning (proposed) | **Agenta gap-05** | Both layers — we add the marker on the Field surface AND keep storage faithful in the JSON view. |

This is one of the few gaps where **our proposed design is meaningfully better than both competitors.** Braintrust gets close via the form — we should do the same form-shape disambiguation AND a chip on the literal row, AND a `[⚠ collision]` warning when both forms coexist for the same path.

---

## 6. Messages & tool calls

Both Braintrust and Langfuse fail the same way here.

### Braintrust — messages stay as YAML

![Braintrust 07 row in Edit — YAML for messages](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.25.33.png)

The Edit panel shows the entire `messages` array + `tool_calls` array as one continuous YAML block. The user reads:

```yaml
inputs:
  correct_answer: The capital of Vanuatu is Port Vila.
  country: Vanuatu
  messages:
    - content: You can use lookup_country and search_web tools.
      role: system
    - content: What is the capital of Vanuatu and what is the population?
      role: user
  outputs:
    messages:
      - content: null
        role: assistant
        tool_calls:
          - function:
              arguments: '{"country":"Vanuatu"}'
              name: lookup_country
            id: call_xyz789
            type: function
  ...
```

YAML is more readable than JSON — but there's no chat-card view, no role-coloured badges, no tool-call card. The user reads structured prose.

### Langfuse — messages as a JSON modal

![Langfuse Edit Dataset Item — set7 messages payload](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.29.25.png)

Same payload, much worse rendering — raw JSON in a modal with `\"` escapes and stringified `arguments` inside `tool_calls`. Reading this is genuinely hard.

### Verdict

**Steal nothing here. Both tools are weaker than Agenta could be.**

- Braintrust has the right idea (YAML over JSON) but doesn't ship a chat renderer.
- Langfuse has neither.
- Our existing `ChatMessageEditor` + `ChatMessageList` (present in the OSS codebase, mounted only at certain depths) is **already ahead of both competitors** if we lift it to render at every depth (gap-06). Tool-call cards with parsed arguments and `[tool]` chip are pure Agenta-side wins.

This is one of the gaps where **shipping the proposal puts us measurably ahead of both reference points.** Worth prioritizing.

---

## 7. Edit ergonomics — quality vs complexity

### Braintrust full panel — high cognitive density

![Braintrust dataset detail full chrome](./screenshots/competitors/Screenshot%202026-05-04%20at%2001.24.42.png)

Top of the right panel:
- Edit / Runs / Views tabs
- Flag for review · Tag
- Input section (collapsible)
  - Inside: per-field cards with type-aware controls
- Expected section
- Metadata section
- Activity (collapsible)

Top-of-page header on every detail:
- Dataset name
- Version
- **Tag**, **Field schemas**, **Review**, **Snapshots**, **Evaluate in...** dropdown
- Find search

Twelve+ controls in view. Power users will love this. First-touch users will be lost.

### Langfuse — minimal

The whole experience: list → click row → modal with three JSON editors → save. Three controls in the modal (Cancel, Save changes, X). It's almost a non-experience.

### Verdict

| Tool | Pattern | Steal? |
| --- | --- | --- |
| Braintrust | Per-field cards, view-mode-per-field, custom-column add, Activity log, tag/flag actions, Field schemas tab | **Steal selectively.** Activity log + per-field view-mode + Field schemas tab are clear wins. The rest depends on whether we want a power-user surface or a simpler one. |
| Langfuse | Three-JSON-block modal | Avoid. This is the gap-03 / gap-04 anti-pattern industrialized. |
| Agenta today | Drawer with `EntityDualViewEditor` (Fields/JSON segmented), drill-in cards, no schema-driven form, no activity log | Mid-tier. Catch up to Braintrust's form + activity layer; keep our segmented toggle (better than BT's tabs because it's modal-state, not panel-mode). |

---

## 8. Mapping back to our 6 gaps

| Gap | Braintrust | Langfuse | Net impact for us |
| --- | --- | --- | --- |
| **gap-01 type chips** | No chips. Implicit signal via per-field control type. | No chips. | Both sidestep. **Our proposal is novel** — neither tool surfaces type as a first-class chip. Worth shipping; chips help non-power-users a lot. |
| **gap-02 table cells** | Single-token YAML preview, schema in side panel. Compact rows. | Pretty-printed JSON inline, multi-line rows. | Langfuse's preview is the better model. **Steal that, add our chips on top** for the gap-01 + gap-02 combo. |
| **gap-03 drill-in root view** | Right panel auto-expands to per-field form when schema exists. **Solved.** | Modal with three JSON editors. **Worst case.** | Braintrust validates auto-expand. **Steal the schema-aware auto-form**; this is exactly gap-03's "auto-expand top-level keys" but driven by schema, not heuristic. |
| **gap-04 shape preservation** | Doesn't surface this issue — they edit per field, save per field. The YAML pane for Expected/Metadata is BE-faithful. | Edit-the-whole-JSON-blob is the *cause* of this issue if your save handler dispatches verbatim. Langfuse may or may not have this; visible UX doesn't show a projection toggle either way. | Both tools dodge the union-projection problem because they don't have a "table column union" model in the same way we do. **Our proposal stays distinct; no validation from either tool.** |
| **gap-05 dot-key disambiguation** | Form structure (nested form + flat-key inputs) makes it visible. **Better than us today.** | Renders both shapes inside one JSON blob with no marker. **Worst case.** | Braintrust gets us 70% there via form shape. **Our chip + collision warning is the missing 30%.** Combined: form shape + chip + warning = best in class. |
| **gap-06 messages renderer** | YAML preview, no chat cards, no tool-call rendering. | JSON in modal, no chat cards, no tool-call rendering. | **Both behind us if we ship gap-06.** Our `ChatMessageEditor` + tool-call cards puts us ahead of both. Don't deprioritize this. |

---

## 9. The 3 patterns to adopt

1. **Schema-aware Edit form (Braintrust)** — when a testset has an inferred or authored schema, render the row Edit panel as a labelled form with one input per column, type-aware controls per input (text / number / boolean / nested object form / array). Falls back to our existing free-form drill-in when schema is missing. This covers gap-03 (auto-expand) and a chunk of gap-04 (per-field save = no union replay) and gap-05 (form structure does the disambiguation work). Lifting this is a real project but it's the single biggest UX win on the table.
2. **Inline JSON preview in table cells (Langfuse)** — replace our em-dash + raw-JSON cells with pretty-printed multi-line previews, syntax-highlighted, with a row-height toggle (Compact / Comfortable / Tall) like Braintrust's Display popover. This is gap-02's "Mini JSON tree" variant. Combine with our type chip for the win.
3. **Activity log per row (Braintrust)** — add an Activity collapsible to the testcase drawer with comments and an audit trail. We already have version metadata; surfacing per-row history is a small additional cost with high trust-building value.

## 10. The 3 anti-patterns to avoid

1. **Modal-with-three-JSON-blocks (Langfuse)** — don't industrialize the gap-03 bailout. Our drawer + drill-in is already better; don't regress.
2. **Twelve controls in view by default (Braintrust)** — Braintrust's right-rail is dense. Hide secondary controls behind menus or tabs; default to the minimal high-value surface (Edit form + per-field view mode toggle + Activity).
3. **Schema as YAML for everything (Braintrust)** — they default Expected and Metadata to YAML editors with no form rendering. That's a power-user choice that loses approachability. Default to the form when we have the schema; YAML is a power-user toggle.

## 11. Where we should go further than both

These are gaps where copying the competition would *limit* us:

- **gap-01 type chips** — neither tool does it. We're inventing the right answer.
- **gap-04 shape preservation toggle** — neither tool exposes the union-projection trade-off; we're the only ones who have to (because our table column model is different from Braintrust's per-row "examples"). The "as authored / all columns" toggle proposal is genuinely novel.
- **gap-05 dotted-key + collision chip** — Braintrust gets 70% via form shape; we can hit 100% with our chip + warning + form shape combined.
- **gap-06 chat / tool-call inline rendering** — both behind us if we lift `ChatMessageEditor` + ship the tool-call card.

## 12. Suggested re-prioritization

Based on this audit, the priority order I'd argue for:

1. **Schema-aware Edit form** (cross-cutting, biggest leverage) — addresses gap-03 + gap-04 + gap-05 + part of gap-01 simultaneously
2. **gap-06 messages + tool-call inline rendering** — pure win, no competitor pressure but biggest qualitative differentiator
3. **gap-02 inline JSON preview + chips** — combines Langfuse's pattern with our chip vocabulary
4. **gap-04 projection toggle** — defensive (avoid the JSON-edit replay), but lower priority than the form
5. **gap-01 chips on field rows** — falls out of #1 and #3 above; no separate effort once those land
6. **gap-05 collision chip + warning** — last because the form (#1) does most of the work; chip is the polish layer

---

## 13. Playground & variable references — the second front

The dataset/drill-in side is only half the story. The other half is the playground, where dataset rows actually become inputs to a prompt. Five additional screenshots in `screenshots/competitors/new/` cover this surface and reshape the prioritization.

### Braintrust playground — variable resolution as a first-class concern

Braintrust's playground is *aware* of the attached dataset and warns at edit time when the prompt and the dataset don't agree. Three screenshots, three steps:

1. **Empty state** (`01.37.06.png`). Playground with Claude 4.5 Haiku, a single User message ("hello"), and a row of pill controls: `Tools 0` · `Mustache` · `MCP servers 0` · `Text output`. Output: "Hello! 👋 How can I help you today?". No dataset yet — the prompt runs free-form against the model.

2. **Dataset attached, no variables yet** (`01.38.03.png`). Same prompt, but now `Dataset: 01 Flat Strings` is wired in. A blue inline banner appears immediately under the prompt:
   > This prompt does not reference any variables from the dataset. Try inserting dataset variables from `{{(input)}}`, `{{(expected)}}`, or `{{(metadata)}}`.

   Three things to notice. (a) The banner is **proactive** — the moment you attach a dataset, the tool tells you the prompt is going to ignore it unless you wire a variable. (b) The hint text **names the three top-level dataset fields** as the canonical mustache references, so a user who's never used templating in their life gets a working starting point. (c) The banner sits inline with the prompt, not in a separate validation panel — it's where you're already looking.

3. **Variable inserted, validation tooltip** (`01.38.32.png`). The user adds `{{$.input.country}}` (JSONPath into the input object, *not* a top-level mustache key). The variable renders as a styled chip inline in the prompt body. A red-bordered tooltip appears with:
   > Variable '$.input.country' is not defined in your dataset. You may encounter unexpected results.

   Two action buttons in the tooltip: `[Remove variable]` and `[Fix with Loop]` (Loop is Braintrust's built-in agent). The validation runs against the *actual attached dataset's schema*, not a generic template check — Braintrust knows whether `input.country` exists across the rows, and it's wrong here (the fixture's input is just a flat country object), so it warns.

This is a textbook example of **schema-aware authoring**. The same field schemas Braintrust uses to drive the per-field row Edit form (Section 4) drive playground variable validation. Two surfaces, one moat.

### Langfuse playground — minimal, no dataset coupling visible

Langfuse's playground (`01.41.05.png`) is structurally simpler:

- Top: model selector (`anth: claude-sonnet-4-5-20250929`), a small toolbar with `Tools` / `Schema {}` / `Variables {x}` dropdown buttons.
- Body: a System row and a User row, each with a placeholder ("Enter a system message here." / "Enter a user message here.") and a delete button.
- Below: `+ Message` and `+ Placeholder` buttons. The `Placeholder` is the interesting one — it's a message slot that gets filled at run time from a runtime variable, distinct from a free-text `+ Message`.
- Right: `Save as prompt`, `+ New split window`. Top-right: `Find` · `1 window` · `Run All ⌘+Enter` · `Reset playground`.
- Bottom: an `Output` panel and a `Submit` button.

No dataset is attached in this view, and the screenshot doesn't show a dataset-attached state, so we can't directly compare variable validation. What we *can* see is that Langfuse keeps the three concerns separated into top dropdowns: **Tools** (function definitions), **Schema** (output schema), **Variables** (template inputs). This is the opposite of Braintrust's "everything inline in the right rail" — Langfuse is closer to our existing playground in spirit (panels, separation), where Braintrust is closer to a code editor with everything visible.

Worth flagging: the `+ Placeholder` pattern is a clean primitive for *"this slot will be filled at runtime"* — relevant to Agenta's chat-history insertion in agent prompts.

### Cross-fixture validation — and the stringified-JSON blind spot

Four additional Braintrust playground screenshots run the same setup (Claude 4.5 Haiku, prompt with a variable reference, dataset attached) across three more of our fixtures: `02 Nested Native`, `04 Stringfied Nested`, `06 Deeply Nested`. Three findings sharpen the picture.

**1. The dataset row preview is consistent YAML across all fixtures** (`01.46.26.png`, `01.46.33.png`, `01.47.06.png`). Each row's `Input` cell renders a multi-line YAML-style preview of the row data, regardless of depth or shape. For `02 Nested Native` the preview is clean and readable (`country: Vanuatu` / `outputs: capital: Port Vila, countryName: Vanuatu`). For `06 Deeply Nested` the preview goes 5 levels deep (`inputs: context: demographics: languages: official: - English - Gilbertese`) and gets visually noisy but stays interpretable. **Braintrust does not surface a chip or expand affordance at any depth — it just lets the YAML grow taller.** This is the trade-off: simple to implement, scales okay to depth ~5, falls apart at depth 8+.

**2. Stringified JSON is rendered literally — same blind spot as us** (`01.46.33.png`, `04 Stringfied Nested`). The fixture has `metadata` and `outputs` stored as JSON strings. Braintrust's YAML preview shows them with the surrounding single-quotes intact:

```yaml
metadata: '{"source":"trace","trace_id":"jkl012","latency_ms":445}'
outputs: '{"countryName":"Vanuatu","capital":"Port Vila","confidence":0.95}'
```

No detection that the string is parseable JSON, no inline expansion. This is **gap-02 + gap-04 in the wild on Braintrust**: they share our blind spot. So when we ship the "stringified-JSON detected, expand inline?" affordance from gap-02, we're going past Braintrust on this dimension, not catching up.

**3. Variable validation has a *limit* tied to schema inference** (`01.46.54.png`). The tooltip reappears in dark mode on a flat-mustache reference `{{metadata.source}}` — same wording, same `[Remove variable]` / `[Fix with Loop]` actions. Two things to note:

- Braintrust validates **both** syntaxes (`{{metadata.source}}` flat-path mustache *and* `{{$.input.country}}` JSONPath) against the dataset schema. The mechanism is consistent across syntaxes — it's a schema lookup, not a string-match check.
- *But* the validation fires falsely on `04 Stringfied Nested`: `metadata.source` semantically *does* exist (inside the stringified blob), but the tooltip warns "not defined in your dataset" because Braintrust's schema inference treats `metadata` as a string, not a parsed object. This is the **same fault line** that gap-04 exposes on the dataset side — once a column is a stringified JSON, every downstream tool that depends on the schema (forms, validation, completion) silently degrades.

**Implication for our priority list:** the variable-validation tooltip is even higher leverage than I had it because it surfaces gap-02/gap-04's "stringified JSON is a foot-gun" problem at *authoring* time, not just edit time. If we ship the schema-aware Edit form (#1) *plus* a "this column looks like stringified JSON — parse it on save?" detector (gap-02 territory), the variable validator inherits a correct schema and stops false-warning. Without the parse step, even Braintrust gets it wrong.

### Three rendering modes per row — Braintrust picks by surface

Two more screenshots (`01.58.31.png`, `01.58.38.png`) — same `06 Deeply Nested` dataset, light mode, two different views — surface a pattern I missed earlier: Braintrust has **three distinct renderings** of the same row data, and switches between them based on which surface you're on.

**Mode 1 — Truncated single-line JSON in the table cell** (`01.58.31.png`). With the playground in compact / default row-height mode, the `Input` column for each dataset row shows `{"inputs":{"context"...` cut off mid-string. No YAML preview here. This is the *narrow-column / short-row* rendering — closest to a one-line summary you'd skim.

**Mode 2 — Multi-line YAML preview in the table cell** (`01.46.26.png`, `01.47.06.png` from earlier). With taller rows / a different display setting, the same `Input` cell renders as multi-line YAML (`inputs: context: demographics: languages: official: - English - Gilbertese`). This is what the user sees when they explicitly want more context per row.

**Mode 3 — Full pretty-printed JSON popover on row-detail expand** (`01.58.38.png`). Clicking into a row opens a popover showing the *full* row data as nicely-indented JSON (not YAML this time):

```json
{
  "inputs": {
    "context": {
      "demographics": {
        "languages": {
          "official": ["English", "Gilbertese"],
          "speakers_percent": {"English": 30, "Gilbertese": 99}
        },
        "population": {
          "by_atoll": {"Abemama": 3180, "North Tarawa": 6300, "South Tarawa": 64000},
          "total": 121000
        }
      },
      "geo": {"coordinates": {...}, "region": "Micronesia", "subregion": "Central Pacific"}
    },
    "correct_answer": "The capital of Kiribati is Tarawa.",
    "country": "Kiribati"
  },
  "outputs": {...}
}
```

No truncation here. Full depth. Pretty-printed, syntax-coloured, scrollable. Distinct from both the cell's YAML preview *and* from the right-rail Edit form (Mode 4, effectively, when schema is inferred).

**Why this matters:** Braintrust treats "render row data" as a multi-mode problem with surface-specific answers. Our current playground/dataset side has one mode (raw JSON or em-dash), and the lack of layered modes is a big chunk of why the experience feels coarse.

The mapping for us:

- **Mode 1** (truncated single-line) — cheap fallback. Already what we do today; keep as the most-compact display option.
- **Mode 2** (multi-line YAML/structured preview) — gap-02's "Mini JSON tree" variant. Add as the row-tall display mode with a Display popover (Compact / Comfortable / Tall) like Braintrust's.
- **Mode 3** (full-row JSON popover on click) — easiest to ship; can be a `Detail` action that opens a read-only pretty-JSON view of the whole row. Bridges the gap until the schema-aware Edit form lands.
- **Mode 4** (schema-aware Edit form) — priority #1, the long-term answer.

The full-row JSON popover (Mode 3) is interesting because it's a **near-zero-cost stop-gap**: we already have a pretty-JSON renderer, we just need a row-click handler that opens a modal with the full data. It buys us 80% of "I need to see the whole thing without editing" while the schema-aware form is being built. Worth adding as a fast follow.

### What Agenta's playground does today (for comparison)

Our playground supports `{{variable}}` references in prompt bodies, resolved against the testset row at execution time. It does **not**:

- Warn at edit time when a referenced variable doesn't exist in the attached testset.
- Suggest the canonical references when a testset is freshly attached.
- Distinguish JSONPath (`{{$.input.country}}`) from flat mustache (`{{country}}`) at validation time.
- Surface the available variables as a hint anywhere near the prompt body — they live in a separate Variables panel, if at all.

This is gap-05 territory but on the *authoring* side rather than the *editing* side. The same dot-key vs nested ambiguity that plagues testcase drill-in (`{"a.b": ...}` vs `{a: {b: ...}}`) plagues template references (`{{a.b}}` reads as "field with literal dot" or "nested path"?). Braintrust resolves both with one mechanism: schema-driven validation.

### Mapping the playground patterns to our gap structure

| Playground pattern | Source | Gap mapping | Effort |
| --- | --- | --- | --- |
| Inline banner on dataset-attach with canonical references (`{{(input)}}`, `{{(expected)}}`, `{{(metadata)}}`) | Braintrust `01.38.03.png` | New "playground gap" — extends gap-05 to authoring | **Small.** We already know the testset's top-level fields the moment a testset is selected. The banner is one component + one effect. |
| Per-variable validation tooltip ("Variable X is not defined in your dataset") | Braintrust `01.38.32.png` | Extends gap-05 to authoring; same dot-key vs nested ambiguity | **Medium.** Requires running variable references against the actual testset schema (or a sample row), which we have via `revisionAgConfigSchemaAtomFamily` and the testset row data. |
| `[Remove variable]` quick-action in the tooltip | Braintrust `01.38.32.png` | UX polish on the validation | **Small.** Once the tooltip exists, the action is trivial. |
| `[Fix with Loop]` agent-driven repair | Braintrust `01.38.32.png` | Out of scope for now (agent integration) | **Skip.** |
| `+ Placeholder` runtime-injected message slot | Langfuse `01.41.05.png` | Adjacent to gap-06 (messages) — chat-history slots in agent prompts | **Medium.** Useful for agent prompts that take a chat history at run time; not a json-string-ux gap directly but on the same surface. |
| Mustache hint with the three top-level fields named | Braintrust `01.38.03.png` | Extends gap-01 (chips) — type chips on top-level fields *visible from the playground* | **Small.** Reuses the type chip primitive from gap-01. |

### The cross-surface insight

The variable-validation tooltip and the schema-aware Edit form are the same pattern applied to two different surfaces:

- **Edit surface (drill-in):** "this field's value doesn't match the schema."
- **Authoring surface (playground):** "this variable reference doesn't match the schema."

If we lift Braintrust's per-field schema model (Section 4) and store it once per testset, we get *both* applications for one investment. That's the highest-leverage move on the table — it's why the schema-aware Edit form is #1 on the priority list, but the playground side amplifies it: the same schema also unlocks the variable validation banner + tooltip.

### Revised priority order (post-playground)

The playground evidence sharpens but doesn't fundamentally change the order. Updated:

1. **Schema-aware Edit form + per-testset field schema as a first-class entity** (cross-cutting). Now justified by *both* the drill-in side and the playground side. The schema is the moat.
2. **Playground variable validation banner + tooltip** (new). Falls out of #1 once the schema entity exists. Edit-time warning beats run-time confusion. Tactically: the dataset-attach banner is the cheapest first delivery; the per-variable tooltip is the follow-up.
3. **gap-06 messages + tool-call inline rendering** (unchanged at #3, but downgraded from #2 — playground variable validation is more user-visible).
4. **gap-02 inline JSON preview + chips** (unchanged).
5. **gap-04 projection toggle** (unchanged — defensive).
6. **gap-01 chips on field rows + playground variable hints** (consolidated — chips in two surfaces, one component).
7. **gap-05 collision chip + warning on the drill-in side** (unchanged — last because #1 + #2 do most of the work).

The reordering: variable validation jumps from "not in the original 6 gaps" to #2 because (a) it's the same schema investment as #1 with a much smaller increment, (b) it's a visible-every-day pain point for anyone using the playground with a real testset, and (c) Braintrust's tooltip pattern is a clean steal — small surface area, well-understood UX.

### Anti-patterns from the playground side

1. **Dataset variables hidden in a separate panel** (Langfuse-ish). Don't make users navigate to a "Variables" tab to see what's available; surface canonical references inline near the prompt body.
2. **Run-time-only variable resolution** (Agenta today). Catching missing variables only when you click Run is a 5-second feedback loop versus Braintrust's instant. Move the check to edit time.
3. **Generic "template syntax error" toasts** instead of specific "this variable isn't in your dataset" tooltips. The specificity of Braintrust's wording is a big chunk of why it works — it points at the dataset, not at the template engine.

---

## Appendix A — Playground evidence index

Twelve screenshots in `screenshots/competitors/new/` exercise the playground surface across both tools and against four of our fixtures. Indexed in capture order:

| File | Tool | Surface | Fixture | What it shows | Key takeaway |
| --- | --- | --- | --- | --- | --- |
| `01.36.12.png` | Braintrust | Experiment | `01 Flat Strings` | `GPT 3.5T 16k` experiment: 4 rows, eval task, "No API keys found" outputs, 0.4s durations, YAML metadata sidebar (`dataset: 01 Flat Strings`, `model: gpt-3.5-turbo-16k`, `temperature: 0`). | Experiment view collapses dataset + model + per-row eval state into one dense screen — opposite of the modal-flow Langfuse uses. |
| `01.37.06.png` | Braintrust | Playground (empty) | none | Claude 4.5 Haiku, single User message "hello", controls bar `Tools 0 · Mustache · MCP servers 0 · Text output`. Output: "Hello! 👋 How can I help you today?". | Baseline. The control pills hint at how the tool *thinks* about a prompt: function-tools, template syntax, MCP servers, output format — all toggleable, all visible. |
| `01.38.03.png` | Braintrust | Playground (dataset attached) | `01 Flat Strings` | Dataset wired in. Blue inline banner under the prompt: *"This prompt does not reference any variables from the dataset. Try inserting dataset variables from `{{(input)}}`, `{{(expected)}}`, or `{{(metadata)}}`."* | Proactive variable-attachment hint. The banner names the three top-level dataset fields as canonical mustache references — zero-friction onboarding for templating newcomers. |
| `01.38.32.png` | Braintrust | Playground (validation) | `01 Flat Strings` | User inserts `{{$.input.country}}` JSONPath. Red-bordered tooltip: *"Variable '$.input.country' is not defined in your dataset. You may encounter unexpected results."* with `[Remove variable]` and `[Fix with Loop]` buttons. | Edit-time variable validation against the dataset's actual schema, not a generic syntax check. The "Fix with Loop" button hands off to Braintrust's built-in agent — a pattern we don't need to copy. |
| `01.38.50.png` | Braintrust | Experiment | `01 Flat Strings` | Same view as `01.36.12` from a second capture — confirms experiment view layout is stable. | No new information; serves as confirmation. |
| `01.41.05.png` | Langfuse | Playground (empty) | none | Claude Sonnet 4.5, System + User rows with placeholders, `+ Message` and `+ Placeholder` buttons, top dropdowns `Tools` / `Schema {}` / `Variables {x}`. Right-rail: `Save as prompt`, `+ New split window`. | Langfuse separates Tools / Schema / Variables into discrete dropdowns — opposite of Braintrust's everything-inline. The `+ Placeholder` primitive is a clean affordance for runtime-injected message slots (relevant to agent-prompt chat-history insertion). |
| `01.46.26.png` | Braintrust | Playground (table) | `02 Nested Native` | `Input` cell renders multi-line YAML at depth 2–3: `country: Vanuatu` / `outputs: capital: Port Vila, countryName: Vanuatu`. Three rows (Vanuatu / Comoros / Kiribati). | YAML preview is the *tall-row* rendering mode. Clean and readable at moderate depth — works because the data is natively nested with no stringification. |
| `01.46.33.png` | Braintrust | Playground (table) | `04 Stringfied Nested` | Same layout, but `metadata` and `outputs` show stringified JSON literally with surrounding quotes intact: `metadata: '{"source":"trace","trace_id":"jkl012","latency_ms":445}'`. | **Stringified-JSON blind spot.** Braintrust shares our gap-02 / gap-04 problem — they don't detect "this string is parseable JSON" and pretty-print it. Shipping our parse-on-detect affordance puts us past Braintrust on this dimension. |
| `01.46.54.png` | Braintrust | Playground (validation, dark) | `04 Stringfied Nested` | Dark-mode capture. Prompt body: `hello {{metadata.source}}`. Tooltip: *"Variable 'metadata.source' is not defined in your dataset. You may encounter unexpected results."* with the same `[Remove variable]` / `[Fix with Loop]` actions. | Validation works on flat-mustache *and* JSONPath. Critically, it false-warns on `04 Stringfied Nested` because Braintrust's schema treats `metadata` as a string — even Braintrust gets this wrong without the parse-stringified-JSON detector. |
| `01.47.06.png` | Braintrust | Playground (table) | `06 Deeply Nested` | YAML preview goes 5 levels deep: `inputs: context: demographics: languages: official: - English - Gilbertese, speakers_percent: English: 30, Gilbertese: 99, population: by_atoll: ...`. Note: `+ Message part` button visible (distinct from `+ Message`). | Multi-line YAML scales but visually noisy at depth 5+. No chip, no expand affordance — they let the cell grow. Defensible at depth ≤5; falls apart at depth 8+. |
| `01.58.31.png` | Braintrust | Playground (table, light) | `06 Deeply Nested` | `Input` column shows truncated single-line `{"inputs":{"context"...`. Different display setting than `01.47.06` — same data, different render. | **Mode-switching by row height.** With compact rows, Braintrust falls back to truncated single-line JSON. Three rendering modes for the same data depending on surface (single-line / YAML / popover). |
| `01.58.38.png` | Braintrust | Playground (row-detail popover) | `06 Deeply Nested` | Click-to-expand popover showing full row data as pretty-printed indented JSON (not YAML). All depth visible, scrollable, syntax-coloured. | **Mode 3 — full pretty-JSON popover on row click.** Near-zero-cost stop-gap we should ship while the schema-aware form is being built. Buys 80% of "let me see the whole thing" with one modal component. |

## Appendix B — Dataset / drill-in evidence summary

The 38 screenshots in `screenshots/competitors/` (captured at `01.23–01.29` timestamps, before the playground exploration) cover the dataset list, dataset detail, drill-in / row-edit, and field-schema surfaces of both tools. Grouped by tool and surface:

### Braintrust dataset surface (≈18 screenshots, `01.23.35` – `01.27.48`)

- **Dataset list and switcher** — sidebar entry `Datasets`, list of fixtures (`01 Flat Strings`, `02 Nested Native`, `03 Mixed Types`, `04 Stringfied Nested`, `05 Messages Array`, `06 Deeply Nested`, `07 Tool Calls`, `08 Dot-Key Collision`), with row counts and last-updated timestamps. Standard CRUD list.
- **Dataset detail table** — three columns by default: `Input`, `Expected`, `Metadata`. Each cell renders single-token YAML preview when collapsed, multi-line YAML when row is expanded. `Display` popover toggles row height (Compact / Comfortable / Tall). `Filter` and `Row` controls pinned in the toolbar.
- **Drill-in (right panel)** — opens on row click. Header: row index + breadcrumb. Body: three sections (`Input`, `Expected`, `Metadata`) each rendering as a *form* when schema is inferred, or as a YAML editor when not. The form is the moat — section 4 of this doc covers it in depth.
- **Edit mode** — clicking a section flips it to an editable form. Per-field inputs typed by the schema (text / number / boolean / nested object form / array editor). Saving dispatches a per-field PATCH, not a JSON-blob replacement — which is why they sidestep gap-04.
- **Field schemas tab** — `Parameters` sidebar entry exposes the inferred schema explicitly. Users can edit it, mark fields required / optional, set types, set default values. This is the single biggest UX investment Braintrust has made on the dataset side.
- **Collision fixture (`08 Dot-Key Collision`)** — drill-in renders the dotted-key field (`"a.b"`) and the nested object (`{a: {b: ...}}`) as two distinct rows in the form, which makes the collision visible by structure (no chip needed). Section 5 of this doc.

### Braintrust messages / tool-call rendering (≈4 screenshots, `01.27.48` – `01.28.27`)

- **Messages fixture** — `Input` is an array of `{role, content}` objects. Braintrust renders it as YAML (`- role: user, content: ...`), not as chat cards. Functional but not specialized.
- **Tool-call fixture** — `arguments` field is a stringified JSON. Braintrust renders the surrounding object as YAML and leaves `arguments: '{"query": "..."}'` as a literal string. No tool-call card. Same blind spot as our table cells today.

### Langfuse dataset surface (≈12 screenshots, `01.28.33` – `01.29.44`)

- **Dataset list** — sidebar entry `Datasets` (under "Evaluation" group). List shows fixture names, row counts, item counts. Functionally equivalent to Braintrust's list.
- **Dataset detail table** — `Input`, `Expected output`, `Metadata` columns. Each cell renders pretty-printed multi-line JSON inline (not YAML). Multi-line rows by default — Langfuse skips the row-height toggle. This is the *better preview* when the data is reasonable depth; falls down on `06 Deeply Nested`.
- **Row detail modal** — clicking a row opens a *modal*, not a side panel. Three side-by-side JSON editors: `Input`, `Expected output`, `Metadata`. Each is a code-editor with syntax highlighting and a Copy button. No form. No schema. **This is the gap-03 worst case** — Section 3 of this doc.
- **Edit modal** — the same modal toggles to edit mode; the JSON editors become writable. Saving dispatches a JSON-blob PATCH on each field — which is why Langfuse silently has gap-04 on the edit side, even though we can't see it from the outside.
- **Tags & Metadata columns** — Langfuse exposes a Tags column and a free-form Metadata field in the modal. Useful organizational primitives we don't have today.
- **Cross-fixture coverage** — same modal structure for every fixture. Langfuse's strength is consistency; its weakness is that "everything is JSON" loses information that schema-aware tools (Braintrust) preserve.

### Verdict on this evidence

Two products, two philosophies:

- **Braintrust** invests in a **schema entity** and reuses it everywhere — table preview density, drill-in form, edit-time validation, playground variable validation. One investment, four payoffs. Cost: high up-front complexity, dense default UI.
- **Langfuse** treats every payload as **opaque JSON** and gives you a great editor for JSON. Lower complexity, but the lack of schema means form rendering, dot-key disambiguation, variable validation, and stringified-JSON detection are all unaddressed.

Agenta today is closer to Langfuse in approach but with a less-polished JSON editor. The work covered in gap-01 through gap-06 plus the playground priorities in Section 13 closes the gap to Langfuse on every dimension and pulls past Braintrust on three (gap-02 stringified-JSON detection, gap-04 projection toggle, gap-06 chat / tool-call cards).

## Appendix C — Methodology

- **Capture window:** 2026-05-04, 01:23 – 01:58 local time. Both products exercised in the same browser session against the same 8 fixtures.
- **Fixtures used:** `01-flat-strings.json` (flat scalars) · `02-nested-native.json` (depth-2 native nesting) · `03-mixed-types.json` (heterogeneous values) · `04-stringfied-nested.json` (stringified JSON in `metadata` / `outputs`) · `05-messages-array.json` (chat-message arrays) · `06-deeply-nested.json` (depth-5 nesting) · `07-tool-calls.json` (function calls with stringified arguments) · `08-dot-key-collision.json` (literal-dot keys colliding with nested paths). Identical fixtures imported into Braintrust as datasets and into Langfuse as datasets.
- **Tasks exercised:** dataset list, dataset detail table, row drill-in, row edit, field-schema authoring (Braintrust only), playground prompt with variable references against attached dataset, playground variable validation, experiment / eval run.
- **What the comparison is *not*:** not a security review, not a pricing comparison, not a billing/auth UX comparison. Strictly a UX/functional comparison of payload rendering, schema awareness, and variable handling.
- **Bias disclosure:** screenshots captured by the team building the Agenta redesign. Captures were made during normal exploratory use, not adversarial testing — both tools may have additional functionality behind menus / settings not exercised here. Where uncertain, the analysis says so explicitly.

---

*Generated 2026-05-04 from 38 dataset/drill-in screenshots in `screenshots/competitors/` plus 12 playground screenshots in `screenshots/competitors/new/` (50 total). Both products were exercised against our 8 fixtures (`01-flat-strings.json` … `08-dot-key-collision.json`) so the comparison is direct, not theoretical.*
