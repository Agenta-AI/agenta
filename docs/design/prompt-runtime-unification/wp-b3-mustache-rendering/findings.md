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

The original scan also surfaced four issues, all now resolved (see Closed Findings): the JSONPath pre-render stage (`{{$...}}`) re-exposed resolved values to the Mustache engine so they were recursively rendered, unlike plain `{{var}}` tags (WPB3-001); a tag-claiming case where a `{{$...}}` that is not valid JSONPath raised rather than rendering as a plain variable (WPB3-002, kept strict by decision); a frontend molecule that silently coerced `mustache -> curly` (WPB3-003); and test-coverage gaps on the riskiest behaviors (WPB3-004).

Update (2026-05-22): all four findings are fixed and moved to Closed; there are no open findings.

- WPB3-004 (test gaps) and WPB3-003 (frontend coercion) fixed (2026-05-21).
- WPB3-001 + WPB3-002 (JSONPath `{{$...}}` handling) resolved together (2026-05-22) by unifying JSONPath across curly / mustache / jinja2: a shared `_render_with_jsonpath` resolves `{{$...}}` to a value, substitutes it into the rendered output last, and never re-parses it — exactly what `curly` already did, now extended to mustache and jinja2. Failure handling also matches `curly` (`UnresolvedVariablesError` for both missing and malformed `{{$...}}`). The interim `MUSTACHE_RENDER_ORDER` switch and `MustacheInvalidJsonPathError` were removed. Context-provenance analysis confirmed no OS-secret/env-var leak is possible (the render context is explicitly and narrowly constructed); the issue was the chain-of-replacement ordering surprise, now removed. Cross-format parity is pinned by `test_jsonpath_parity_across_formats` / `test_jsonpath_failure_parity_across_formats`.

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
- ~~Should a context variable whose name legitimately starts with `$` be addressable as a plain Mustache variable, or is `{{$...}}`-is-always-JSONPath absolute? (WPB3-002.)~~ **Resolved 2026-05-22: `{{$...}}` is always JSONPath, and failure handling matches `curly`** — a failed `{{$...}}` (malformed or missing) is reported as `UnresolvedVariablesError`. See closed WPB3-002.

## Open Findings

(none — all findings resolved as of 2026-05-22)

## Closed Findings

### [CLOSED] WPB3-001 — JSONPath value re-render divergence, fixed by unifying `{{$...}}` handling across curly / mustache / jinja2

- ID: WPB3-001
- Origin: scan
- Lens: verification
- Severity: P1 (downgraded in scope after context-provenance analysis — see below)
- Confidence: high
- Status: fixed (2026-05-22) — `{{$...}}` now resolved as inert data in all three formats
- Category: Correctness / Consistency (originally also flagged Security)
- Summary: `_prerender_jsonpath_tags` substituted `{{$...}}` with the coerced value as literal template text, then handed the whole string to `mystace`, so any `{{...}}`/section syntax inside the resolved value was rendered a SECOND time. Plain `{{var}}` tags are never recursive, so the two paths diverged. The surprise is the chain-of-replacement ordering, not an OS-secret leak.
- Context-provenance analysis (answers "can secrets/env vars be accidentally included?"): **No.** The render context for both paths is explicitly and narrowly constructed; there is no `os.environ`, globals, or wildcard merge.
  - Normal prompts: context is exactly `run_inputs["variables"]` (`handlers.py:3488,3493`).
  - LLM-as-a-judge: context is a hand-built dict with a fixed key set — `parameters`, `ground_truth`/`correct_answer`/`reference`, the spread of `inputs` plus `inputs`, `prediction`/`outputs`, `trace` (`handlers.py:991-1031`).
  - The real (bounded) risk was cross-field within that defined context: an untrusted field (`prediction`, `inputs`) pulled via `{{$...}}` and containing `{{ground_truth}}`/`{{$.parameters...}}` could echo another context field or inject control flow into the judge prompt. Bounded, not OS-level — but still an integrity surprise worth removing.
- Decision (user, 2026-05-22): drop the alternative-ordering switch; pick the single design that **matches what `curly` already does** (resolve `{{$...}}` to a value, substitute verbatim, never re-parse) and **extend it to jinja2 too**, so curly / mustache / jinja2 behave the same with respect to JSONPath. (Supersedes the earlier interim `MUSTACHE_RENDER_ORDER` switch, which has been removed.)
- Fix applied: a single shared helper `_render_with_jsonpath(template, context, engine=...)` shields `{{$...}}` tags from the engine via NUL sentinels, runs the engine, then substitutes the resolved JSONPath values into the output LAST (never re-parsed). Both `_render_mustache` and `_render_jinja2` route through it; `curly` already had this behavior natively via `resolve_any`. Whole-object JSON insertion is preserved verbatim; resolved values behave exactly like plain variable values.
  - Error contract also matched to `curly` (user choice, see WPB3-002): a `{{$...}}` that fails to resolve — malformed syntax *or* no match — is collected and surfaced as `UnresolvedVariablesError`, the same as an unresolved curly placeholder. The interim strict `MustacheInvalidJsonPathError` was removed.
- Files:
  - `sdks/python/agenta/sdk/utils/templating.py` — `_render_with_jsonpath`, `_JSONPATH_SHIELD_RE`, `_render_mustache` (uses shared helper), `_render_jinja2` (now JSONPath-aware), `Callable` import.
- Verification (runtime + tests): identical output across all three formats for field/root/list-index/whole-object/non-recursion/scalar cases, and identical `UnresolvedVariablesError` for missing + malformed `{{$...}}` (runtime parity table confirmed all-identical).
  - New tests: section 16 (jinja2 JSONPath: field/root/list/object/non-recursion/native-tag-coexistence/unresolved/malformed), section 17 (`test_jsonpath_parity_across_formats` and `test_jsonpath_failure_parity_across_formats` run the same inputs through curly+mustache+jinja2 and assert equality), plus mustache `..._is_not_rendered_recursively` / `..._whole_object_insertion_is_not_re_rendered` / `..._unresolved_jsonpath_raises_like_curly` / `..._malformed_jsonpath_is_treated_as_unresolved_like_curly`. 155 render-template tests / 262 across the four suites pass; ruff clean.
- Note: the partial-rejection gap (injected `{{>p}}` inside a resolved value) is closed as a side effect — an injected partial is inserted as literal text after render, never parsed as a partial.

### [CLOSED] WPB3-002 — Failure handling for a `{{$...}}` tag that is not valid JSONPath (final: match `curly`)

- ID: WPB3-002
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22) — final contract matches `curly`
- Category: Correctness / Compatibility
- Decision history:
  - Interim (2026-05-21): strict — a malformed `{{$...}}` raised a dedicated `MustacheInvalidJsonPathError`, distinct from valid-but-missing.
  - **Final (2026-05-22): match `curly` exactly.** As part of unifying JSONPath across curly / mustache / jinja2 (WPB3-001), the user chose to make the failure contract identical to `curly`'s: a `{{$...}}` that fails to resolve — whether malformed syntax or no match — is collected as an unresolved placeholder and surfaced as `UnresolvedVariablesError`. The interim `MustacheInvalidJsonPathError` was removed.
- Net behavior: a context key literally named `$id` is still NOT addressable as `{{$id}}` (the tag is treated as JSONPath, fails, and is reported unresolved) — same as `curly`. The only change from the interim fix is the error *type*: one uniform `UnresolvedVariablesError` instead of a mustache-specific subclass.
- Files:
  - `sdks/python/agenta/sdk/utils/templating.py` — `_render_with_jsonpath` collects failed `{{$...}}` exprs and raises `UnresolvedVariablesError`; `MustacheInvalidJsonPathError` class removed; `MustacheTemplateError` docstring updated.
- Verification: `test_mustache_unresolved_jsonpath_raises_like_curly`, `test_mustache_malformed_jsonpath_is_treated_as_unresolved_like_curly`, and the cross-format `test_jsonpath_failure_parity_across_formats` (asserts curly == mustache == jinja2 all raise `UnresolvedVariablesError` for both missing and malformed). 155 render-template tests / 262 across the four suites pass; ruff clean.

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
