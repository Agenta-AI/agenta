# WP-B3 Mustache Rendering — Verification Scan Findings

## Sync Metadata

- Date: 2026-05-21
- Branch: `feat/add-mustache-rendering` (implementation is UNCOMMITTED in the working tree)
- Base: `main`
- Scan depth: deep (fresh inspection of current code + runtime probes via the SDK `.venv`)
- Origin: scan / Lens: verification

## Sources

Backend / SDK reviewed in full:

- `sdks/python/agenta/sdk/utils/templating.py`
- `sdks/python/agenta/sdk/utils/rendering.py`
- `sdks/python/agenta/sdk/utils/lazy.py`
- `sdks/python/agenta/sdk/utils/types.py`
- `sdks/python/agenta/sdk/utils/resolvers.py`
- `sdks/python/agenta/sdk/utils/helpers.py`
- `sdks/python/agenta/sdk/engines/running/handlers.py` (`_format_with_template`, `auto_ai_critique_v0`, `llm_v0`)
- `sdks/python/agenta/sdk/engines/running/interfaces.py`
- `sdks/python/agenta/sdk/engines/running/builtin.py`
- `api/oss/src/resources/evaluators/evaluators.py`
- `sdks/python/pyproject.toml`, `sdks/python/uv.lock`

Tests reviewed:

- `sdks/python/oss/tests/pytest/unit/test_render_template_helper.py`
- `sdks/python/oss/tests/pytest/unit/test_structured_rendering.py`
- `sdks/python/oss/tests/pytest/unit/test_prompt_template_extensions.py`
- `sdks/python/oss/tests/pytest/unit/test_auto_ai_critique_v0_runtime.py`

Frontend reviewed:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/templateFormatOptions.ts` (+ its vitest)
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx`
- `web/packages/agenta-shared/src/utils/chatPrompts.ts`
- `web/packages/agenta-entities/src/runnable/utils.ts`
- `web/packages/agenta-entities/src/workflow/state/molecule.ts`
- `web/packages/agenta-ui/src/ChatMessage/*`, `web/packages/agenta-ui/src/Editor/*` (token plugins, types)

Design docs reviewed: `research.md`, `qa.md`, `status.md` in `docs/design/prompt-runtime-unification/wp-b3-mustache-rendering/`.

### Summary

The core renderer change is sound and well-layered: `render_template(mode="mustache", ...)` is the single dispatch point, and `rendering.py` (`render_messages` / `render_json_like`) routes the `mode` straight through, so structured judge/chat paths genuinely render mustache (verified, not just type-widened). Coercion (compact JSON for dict/list) and escaping-off match the documented `curly` parity contract, confirmed by runtime probe. Version mapping (v2->fstring, v3/v4->curly, v5->mustache) is robust (`str(... or "3")`), the four LLM-as-a-judge presets are all bumped to v5 + `template_format="mustache"`, and the catalog `settings_template` declares the hidden `template_format`. Existing apps/judges are not migrated (runtime fallback stays `curly`).

However, the JSONPath pre-render stage (`{{$...}}`) has a real correctness/security divergence from the documented contract: pre-rendered values are re-exposed to the Mustache engine and recursively rendered, unlike plain `{{var}}` tags. This enables template injection from untrusted judge context (`inputs`/`outputs`/`prediction`) and bypasses the partial rejection. There is also a tag-claiming trap where any `{{$...}}` that is not valid JSONPath raises rather than rendering as a plain variable, and (originally) a frontend molecule that silently coerced `mustache -> curly`.

Update (2026-05-21): WPB3-004 (test gaps), WPB3-003 (frontend coercion), and WPB3-002 (`{{$...}}` strict contract) are fixed and moved to Closed. WPB3-002 was resolved by user decision in favor of the strict contract, now enforced with a dedicated `MustacheInvalidJsonPathError`. WPB3-001 (recursive re-render / injection) is the single open finding and is held for a user decision on intended behavior; its current behavior is pinned by a change-detector test that must flip to literal-output once a fix lands.

## Notes (verified, no finding required)

- Structured rendering really handles mustache. `render_messages` / `render_json_like` in `rendering.py` pass `mode` verbatim into `render_template` (`rendering.py:59`), and `render_template` dispatches `mustache` first (`templating.py:273-274`). Runtime probe confirms substitution, not fall-through. Not just type-widening.
- Coercion + escaping parity verified at runtime. `_render_mustache` passes `stringify=_coerce_to_str` and `html_escape_fn=lambda t: t` (`templating.py:225-230`). Probe confirmed `{{a}}`->`{"x": 1}` (compact JSON, double quotes), `<b> & "` survives unescaped, `{{{h}}}` unescaped, scalars/None render as `str()`/empty. Matches `curly`.
- Partial / empty-placeholder rejection is correct for top-level templates. `_reject_unsupported_mustache_tags` rejects `{{>...}}` and `{{}}`/`{{   }}` and does NOT false-positive on sections `{{#x}}`/`{{/x}}`, inverted `{{^x}}`, comments `{{!...}}`, or delimiter swaps `{{=<% %>=}}` (regex + runtime probe). Sections/inverted/comments/delimiter-swap/ampersand all render correctly via mystace.
- Version mapping is robust. `template_version = str(parameters.get("version") or "3")` (`handlers.py:911`) coerces None/int; explicit `template_format` always wins (`handlers.py:925`). v3/v4 stay `curly`, v2 stays `fstring` — pinned by `test_version_3_and_4_default_to_curly`.
- No regression for existing apps. `llm_v0` fallback is still `str(parameters.get("template_format") or "curly")` (`handlers.py:3474`); new-app `mustache` defaults live only in the catalog interface schemas (`interfaces.py:280-281, 503, 537`), so existing configs without the field stay `curly`. No silent migration.
- Evaluator presets consistent. All four `auto_ai_critique` presets (hallucination, conciseness, answer_relevancy, helpfulness) are v5 + `template_format="mustache"`; `settings_template` declares hidden `template_format` default `mustache` and version default `5`. No leftover `version: "4"`; the `version: "2"` entries at `evaluators.py:322/334/346` are code-evaluation (python/js/ts) presets. `rag_faithfulness` is commented out (`evaluators.py:823`). NB: scope mentioned a `faithfulness` preset; the actual 4th preset is `helpfulness` — internally consistent, scope-doc artifact only.
- `mystace` pin is clean. `pyproject.toml` `mystace>=1,<2`; `uv.lock` pins `1.0.1` (+ transitive `more-itertools`, `typing-extensions`). No `chevron` leftover. Loaded lazily via `_load_mystace()` with a stable `ImportError`.

## Open Questions

- Is recursive rendering of JSONPath-resolved values (WPB3-001) intended? If yes, the docstring is wrong and the injection surface needs an explicit security decision; if no, the pre-render output must be neutralized. Recommend `needs-user-decision`.
- ~~Should a context variable whose name legitimately starts with `$` be addressable as a plain Mustache variable, or is `{{$...}}`-is-always-JSONPath absolute? (WPB3-002.)~~ **Resolved 2026-05-21: strict** — `{{$...}}` is always JSONPath; malformed syntax raises `MustacheInvalidJsonPathError`. See closed WPB3-002.

## Open Findings

### [OPEN] WPB3-001 — JSONPath pre-rendered values are recursively re-rendered by the Mustache engine (template injection)

- ID: WPB3-001
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: confirmed (needs-user-decision on intended behavior)
- Category: Security / Correctness / Consistency
- Summary: `_prerender_jsonpath_tags` substitutes `{{$...}}` with the coerced value as literal template text, then hands the whole string to `mystace`. Any `{{...}}` (or section/inverted syntax) contained in the resolved value is therefore rendered a second time by the engine. Plain `{{var}}` tags are NOT recursively rendered, so the two paths diverge, contradicting the documented contract.
- Evidence (runtime probe via `sdks/python/.venv`, against the real `render_template`):
  - `render_template(mode="mustache", template="{{$.untrusted}}", context={"untrusted":"hello {{secret}}","secret":"LEAK"})` -> `'hello LEAK'` (secret leaked through injected tag).
  - `template="{{$.u}}", context={"u":"{{#secret}}leaked{{/secret}}","secret":True}` -> `'leaked'` (injected section executed).
  - `template="{{$.untrusted}}", context={"untrusted":"x {{> p}} y"}` -> `'x  y'` (injected partial rendered empty — and NOT rejected, because `_reject_unsupported_mustache_tags` runs on the original template before pre-render).
  - Contrast: `template="{{u}}", context={"u":"hi {{secret}}","secret":"LEAK"}` -> `'hi {{secret}}'` (regular var is NOT recursive — the contract `_render_mustache`'s docstring claims for all values).
  - `template="{{$.o}}", context={"o":{"k":"{{v}}"},"v":"X"}` -> `'{"k": "X"}'` (JSONPath dict insertion is also recursively rendered).
- Files:
  - `sdks/python/agenta/sdk/utils/templating.py:182-200` (`_prerender_jsonpath_tags` returns substituted text into the template stream)
  - `sdks/python/agenta/sdk/utils/templating.py:203-236` (`_render_mustache`: reject -> prerender -> `render_from_template` over the prerendered string)
  - `sdks/python/agenta/sdk/utils/templating.py:213-215` (docstring claim: "Variable values are treated as data, not templates ... not rendered recursively" — false for the JSONPath path)
- Cause: The JSONPath pre-render is a string-substitution pass that emits its output back into the template that mystace then parses. Mustache cannot distinguish pre-rendered data from authored template, so injected `{{...}}` / `{{#...}}` / `{{>...}}` inside the resolved value are interpreted. The judge runtime context includes untrusted fields (`inputs`, `outputs`, `prediction`, `ground_truth`, `trace`), so a `{{$.inputs...}}`-style tag over attacker-influenced data can exfiltrate other context values or alter the rendered judge prompt.
- Explanation: This is both a correctness inconsistency (JSONPath values behave differently from plain vars, opposite to the docstring) and a security concern (prompt injection / context exfiltration via the judge's own inputs/outputs). The partial-rejection guarantee is also incomplete because rejection precedes pre-render.
- Suggested Fix:
  - Primary: do not feed JSONPath-resolved values back through the engine. Resolve `{{$...}}` after the mystace render, or render the JSONPath values into the already-rendered output via a final `re.sub`, so resolved data is never re-parsed as a template.
  - Alternative: keep the pre-render order but escape/neutralize Mustache control characters in the coerced JSONPath output (would corrupt JSON braces in whole-object insertion, so post-render is cleaner).
  - Tests to add: a value containing `{{secret}}`, `{{#x}}...{{/x}}`, and `{{> p}}` resolved through `{{$...}}` must render literally; add to `test_render_template_helper.py` section 12.
  - Docs: correct the `_render_mustache` docstring to match actual behavior once fixed.

## Closed Findings

### [CLOSED] WPB3-002 — A `{{$...}}` tag that is not valid JSONPath raises (strict contract + dedicated error)

- ID: WPB3-002
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-21) — user chose the strict contract
- Category: Correctness / Compatibility
- Decision (user, 2026-05-21): **Strict.** Every `{{$...}}` tag is reserved for the JSONPath pre-render pass; a `$`-prefixed name is never treated as a plain Mustache variable. When the body after `$` is not valid JSONPath syntax, raise a *domain-specific* error rather than leaking the raw resolver message or conflating it with missing data.
- Fix applied: added `MustacheInvalidJsonPathError(MustacheTemplateError)` and split the `_prerender_jsonpath_tags` failure handling — malformed syntax (resolver `ValueError`) now raises the dedicated error with an authoring-oriented message; valid-but-unmatched (resolver `KeyError`) keeps the generic "Could not resolve JSONPath" `MustacheTemplateError`. The new class subclasses `MustacheTemplateError` (which subclasses `ValueError`), so every existing broad `except` path still catches it.
- Files:
  - `sdks/python/agenta/sdk/utils/templating.py:75-87` (`MustacheInvalidJsonPathError`)
  - `sdks/python/agenta/sdk/utils/templating.py:200-216` (`_prerender_jsonpath_tags` `_replace`: distinct `except ValueError` branch)
- Verification (runtime probe + tests):
  - `{{$id}}` over `{"$id":"Z"}` -> `MustacheInvalidJsonPathError` ("Invalid JSONPath expression '$id' in a mustache '{{$...}}' tag …").
  - `{{$.nope}}` over `{"a":1}` -> generic `MustacheTemplateError` (NOT the subclass) — missing data stays distinct from malformed syntax.
  - `{{$.profile.name}}` still resolves normally.
  - Pinned by `test_mustache_dollar_prefixed_tag_is_always_jsonpath` (asserts the subclass for malformed, and that the missing-data case is *not* the subclass). 138 render-template tests pass; ruff clean.

### [CLOSED] WPB3-003 — Evaluator-config molecule still coerces `mustache -> curly`

- ID: WPB3-003
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-21)
- Category: Consistency / Compatibility (frontend)
- Summary: `web/packages/agenta-entities/src/workflow/state/molecule.ts` resolved the prompt template format with a hand-rolled `rawFmt === "fstring" || rawFmt === "jinja2" ? rawFmt : "curly"`, which mapped a stored `mustache` format to `"curly"`. The sibling `runnable/utils.ts` `resolveTemplateFormat` had been widened to recognize `mustache`; the molecule copy had not.
- Fix applied: exported `resolveTemplateFormat` from `runnable/utils.ts` and replaced the molecule's inline ternary with `resolveTemplateFormat(rawFmt) ?? "curly"`, eliminating the duplicated logic so there is a single source of truth. `mustache` is now preserved; an unrecognized format still falls back to `curly`.
- Files:
  - `web/packages/agenta-entities/src/runnable/utils.ts:452` (now `export function resolveTemplateFormat`)
  - `web/packages/agenta-entities/src/workflow/state/molecule.ts:52,761-768` (import + `resolveTemplateFormat(rawFmt) ?? "curly"`)
- Verification: `@agenta/entities` `types:check` clean; `pnpm lint-fix` clean across all 11 packages.
- Note: was functionally harmless before the fix (mustache and curly share `{{var}}` extraction), but it removes a real defect risk if `extractTemplateVariables` ever specializes mustache, and restores the WP-B3 preservation invariant.

### [CLOSED] WPB3-004 — Test coverage gaps on the highest-risk mustache behaviors

- ID: WPB3-004
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-21) — tests added; WPB3-001 case pinned-as-current pending its decision
- Category: Testing
- Summary: The new suites covered happy paths, parity, partials, and version defaults, but the riskiest behaviors were untested. Tests have now been added (Python `test_render_template_helper.py` 138 passing; frontend entity-ui vitest 11 passing).
- Tests added:
  - Ampersand-unescape `{{&var}}`: `test_mustache_ampersand_is_unescaped` (section 10) + a `{{&h}}` row in the engine-parity table (`test_mustache_engine_parity_contract`), so a future engine swap is caught.
  - `$`-prefixed plain variable (WPB3-002): `test_mustache_dollar_prefixed_tag_is_always_jsonpath` pins the current strict behavior (`{{$id}}` over a `$id` key raises) until the WPB3-002 contract decision is made.
  - JSONPath recursive-render (WPB3-001): `test_mustache_jsonpath_value_with_placeholder_is_rendered_recursively` pins the CURRENT (divergent) behavior with an explicit in-test note that it is NOT an endorsement and the assertion must flip to literal-output once WPB3-001 is resolved. This was deliberately added as a change-detector, not as a passing security test.
  - Frontend mustache recognition (`chatPrompts.ts`): `web/packages/agenta-entity-ui/tests/unit/chatPromptsMustache.test.ts` asserts `extractPromptTemplateContext` preserves a stored `mustache` format (snake_case and camelCase), extracts `{{var}}` tokens from mustache content, and still defaults to `curly` when no format is declared.
- Files:
  - `sdks/python/oss/tests/pytest/unit/test_render_template_helper.py` (sections 10, 12, 15)
  - `web/packages/agenta-entity-ui/tests/unit/chatPromptsMustache.test.ts` (new)
- Verification: `.venv` pytest 138 passed; ruff format/check clean; entity-ui vitest 11 passed; `pnpm lint-fix` clean.
- Residual (intentionally not added): `PromptSchemaControl.tsx`'s `resolvedTemplateFormat` is an inline `useMemo` inside a React component and is not pure-testable without extracting it; extraction was judged out of proportion to a P2 and the logic is already correct (recognizes `mustache`, sensible fallback). The delimiter-swap × pre-render interaction remains parity-table-only.
