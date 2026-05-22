# Web Handoff — WP-B3 Mustache Rendering

For the frontend engineer integrating against this package. WP-B3 is a backend/SDK change; the web surface here is deliberately minimal (type widening + picker behavior). This document explains what changed for the web, what to QA, and where the boundaries are with later frontend packages.

## TL;DR

- There is a **new template format: `mustache`**. It is now the default for new prompts and new LLM-as-a-judge evaluators.
- For variable highlighting/extraction, **`mustache` behaves exactly like `curly`** — both use `{{name}}`. You do not need new tokenizer logic.
- The picker now **offers only `mustache` and `jinja2`** to new prompts; `curly`/`fstring` are legacy and hidden, but a prompt that already stores one keeps it visible.
- The backend does the rendering. The frontend's job is to **load, preserve, display, and let users pick** the format — not to render it.

## Versions and what shipped

| Surface | Before | After |
| --- | --- | --- |
| `template_format` union (TS) | `"curly" \| "fstring" \| "jinja2"` | `"mustache" \| "curly" \| "fstring" \| "jinja2"` |
| Default for new chat / completion / LLM apps | `curly` | `mustache` (all three `*_v0` interfaces) |
| Picker options offered | curly, fstring, jinja2 | **mustache, jinja2** (legacy formats hidden unless already selected) |
| LLM-as-a-judge evaluator | version `4`, no explicit format | version `5`, `template_format: "mustache"` |
| Engine (Python) | `mystace>=1,<2` added |  |

The union was widened in every web touchpoint that already typed `template_format`:

- `web/packages/agenta-ui/src/Editor/types.d.ts` (`EditorProps.templateFormat`)
- `web/packages/agenta-ui/src/Editor/plugins/token/TokenPlugin.tsx` + `extensions/tokenBehavior.tsx`
- `web/packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx` + `ChatMessageList.tsx`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx`
- `web/packages/agenta-shared/src/utils/chatPrompts.ts`
- `web/packages/agenta-entities/src/runnable/utils.ts` + `workflow/state/molecule.ts`

## The format picker (the one behavioral change)

New file: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/templateFormatOptions.ts`.

`buildTemplateFormatOptions(current)` is the single source of truth for the dropdown:

- New/`mustache`/`jinja2` prompts → options are exactly `["mustache", "jinja2"]`.
- A prompt already storing `curly` or `fstring` → that legacy value is **appended** so it stays visible and selectable. It is never offered to other prompts and the format is never silently coerced.

Hiding the legacy formats had regressed in the past; `templateFormatOptions.test.ts` pins it. If you build new UI that lists formats, **reuse `buildTemplateFormatOptions` / `OFFERED_TEMPLATE_FORMATS`** rather than hardcoding a list again.

## How `mustache` is treated for highlighting/extraction

Plain variables in mustache use the same `{{name}}` delimiters as curly, so they flow through the existing `{{...}}` path:

- `extractTemplateVariables` (`runnable/utils.ts`) and `extractVariablesFromText` (`agenta-shared/chatPrompts.ts`) treat `mustache` with the `curly` regex `/\{\{(\w+)\}\}/g`.
- `TokenPlugin` tokenizes mustache through the default `{{ }}` branch (the jinja2 branch is only for `{% %}` / `{# #}`).
- `resolveTemplateFormat(...)` / `extractPromptTemplateContext(...)` recognize `"mustache"` and preserve it; they fall back to `curly` only when the stored value is unrecognized.

**Caveat for highlighting:** mustache has constructs the simple `{{\w+}}` regex does **not** highlight as variables — sections (`{{#items}}…{{/items}}`), inverted sections (`{{^items}}`), comments (`{{! … }}`), dotted names (`{{a.b}}`), triple-brace (`{{{x}}}`), and `{{$...}}` JSONPath. These render fine on the backend; they just won't all light up as tokens in the editor today. Richer mustache-aware highlighting/autocomplete is **WP-F3 scope**, not this package.

## What to QA

### Mustache basics

- Create a new prompt → `template_format` defaults to `mustache`; picker shows only Mustache + Jinja2.
- `{{name}}` highlights and extracts as a variable, same as curly.
- Open an existing `curly` prompt → it still shows "Curly" selected (not coerced to mustache), and the picker keeps Curly visible.
- Open an existing `fstring` / `jinja2` prompt → unchanged; not promoted to curly or mustache.
- A new LLM-as-a-judge evaluator persists `version: "5"` + `template_format: "mustache"`.
- A new **chat** app and a new **completion** app both default to `template_format: "mustache"` (not just the judge — the default flips for all three `*_v0` workflow interfaces).

### Version migration (v4 → v5) — both must keep working

The mustache default arrives via a **version bump** (judge evaluator and the built-in `auto_ai_critique` go from `4` to `5`; an explicit `template_format` always overrides the version default). The whole point of versioning is that old and new must coexist. Worth exercising the migration explicitly:

1. **Create a v4 entity** (an evaluator/app on the old version) → it resolves to its v4 default (`curly`) and renders with curly, in both the editor (highlighting, picker shows/keeps curly) and at execution (backend renders curly).
2. **Migrate / create a v5 entity** → it resolves to `mustache`, picker offers Mustache, backend renders mustache.
3. **Run both side by side** and confirm each is handled by its own format end-to-end — the v4 one must NOT be silently upgraded to mustache, and the v5 one must NOT fall back to curly. Check this on **both** sides: the frontend (stored format preserved, not coerced; correct picker option visible) and the backend/execution (the rendered output matches the entity's actual format, not the new default).
4. Edge: a v4 (or older) entity that carries an **explicit** `template_format` keeps that explicit value regardless of version — the version default only fills in when the format is absent.

### JSONPath (`{{$...}}`)

`{{$...}}` is unchanged from how `curly`/`jinja2` already behave — this package only makes `mustache` join the same contract. Worth confirming end-to-end against the backend:

- `{{$.profile.name}}`, `{{$.tags[0]}}`, `{{$}}` (whole context as compact JSON), `{{$.profile}}` (nested object as compact JSON).
- A `{{$...}}` value that itself contains `{{other}}` is inserted **inert** — the inner braces are not expanded.
- A failing `{{$...}}` surfaces as an unresolved-variable error, identical across mustache/curly/jinja2.

### Comparing rendering modes

When the same prompt is switched between formats (or compared in the playground):

- `{{name}}` renders the value in all of mustache/curly/jinja2.
- `{{a.b}}` — **mustache** traverses nested objects (`a.b` is `a` then `b`); **curly** prefers a literal dotted key first. This is a real semantic difference, not a bug — flag it if QA compares dotted-variable output across modes.
- HTML is **not** escaped in any mode (prompt text isn't HTML); `{{{x}}}` and `{{x}}` produce the same output in mustache.
- dict/list values render as **compact JSON** (matching curly), not Python `repr`.

### Escaping literal `{{ }}`

There is **no backslash escape** (`\{{name}}` emits a literal backslash and still expands the tag). To emit literal braces:

- **mustache**: delimiter swap — `{{=<% %>=}}This {{is}} literal.<%={{ }}=%>`.
- **jinja2**: `{% raw %}{{not_a_variable}}{% endraw %}`.
- **curly**: no mechanism — author such prompts in mustache/jinja2.

See `escape-analysis.md` and `_mustache-templates.mdx` for the full reasoning. If the editor ever needs to *help* authors emit literal braces, that's a future enhancement (deferred — Option 3 in the analysis), not in scope here.

### Error surfacing

The backend rejects, with a clear message: partials (`{{>x}}`), empty placeholders (`{{}}` / `{{   }}`), JSON-Pointer tags (`{{/a/b}}`), and NUL bytes. Confirm these errors render usefully in whatever surface invokes rendering (playground run, evaluation), rather than failing silently or with a raw stack trace.

Note an error-message change that is mostly invisible but worth knowing: the "Unreplaced variables in … template" message now names the actual format (e.g. "…in mustache template…") instead of always saying "curly". For curly the wording is unchanged; the new labels appear for mustache/jinja2 when a `{{$...}}` tag fails to resolve. If any frontend code string-matches that message (it shouldn't), the format word is now variable.

## Integration considerations / boundaries

- **The frontend does not render templates.** Mustache rendering happens in the SDK/backend at invocation time. Don't add a JS mustache renderer for prompt preview unless you deliberately match the backend's three deviations (JSONPath, HTML-escape off, compact-JSON) — divergence will confuse users.
- **Always preserve the stored format.** Never coerce an unknown/legacy `template_format` to a different one on read; pass it through (`resolveTemplateFormat` returns `null` for unknown, callers fall back to `curly` only as a last resort).
- **Type drift risk:** if you find another `"curly" | "fstring" | "jinja2"` union anywhere in web, widen it to include `"mustache"` — a few may have been missed outside the packages above.
- **Out of scope (later packages):** native JSON transport for prompt variables (WP-F2), mustache-aware autocomplete and section/JSONPath highlighting (WP-F3). This package leaves enough schema/type support for those to build on.

## Quick reference — files touched on web

```
agenta-ui/src/Editor/types.d.ts
agenta-ui/src/Editor/plugins/token/TokenPlugin.tsx
agenta-ui/src/Editor/plugins/token/extensions/tokenBehavior.tsx
agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx
agenta-ui/src/ChatMessage/components/ChatMessageList.tsx
agenta-shared/src/utils/chatPrompts.ts
agenta-entities/src/runnable/utils.ts                       (resolveTemplateFormat now exported)
agenta-entities/src/workflow/state/molecule.ts
agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx
agenta-entity-ui/src/DrillInView/SchemaControls/templateFormatOptions.ts   (new)
agenta-entity-ui/tests/unit/templateFormatOptions.test.ts                  (new)
agenta-entity-ui/tests/unit/chatPromptsMustache.test.ts                    (new)
```
