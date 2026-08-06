# WP-B3 Mustache Rendering — Verification Scan Findings

## Sync Metadata

- Date: 2026-05-22 (sync against PR #4393; prior scan 2026-05-21)
- Branch: `feat/add-mustache-rendering` (implementation committed; working tree clean at 057a29658)
- Base: `main`
- PR: <https://github.com/Agenta-AI/agenta/pull/4393>
- Scan depth: deep (fresh inspection of current code + runtime probes via the SDK `.venv`)
- Origin: scan + sync / Lens: verification

### PR #4393 sync sources (2026-05-22)

Inline review threads pulled (all unresolved at sync time). Two map to current committed code/contract and became findings WPB3-008/009; the rest are RFC/design-doc discussion threads (mostly on `rfc.md`, `README.md`, `research.md`) that belong to the design phase, not the committed SDK implementation, and are left untouched:

- `3286635303` (Copilot, `templating.py:330`) → WPB3-008 (docstring Raises mismatch).
- `3286635369` (Copilot, `qa.md:155`) → WPB3-009 (QA plan vs permissive-missing-var contract).
- mmabrouk RFC questions (`3280747520`, `3280751193`, `3280753760`, `3280759652`, `3280761180`, `3280767036`, `3280770190`, `3280772919`, `3280776786`, `3280781711`, `3280782719`, `3280788530`, `3280794168`, `3280800719`) — design discussion / out-of-scope notes; not code findings.
- coderabbit/Copilot doc nitpicks (`3280567210`, `3280579197`, `3280579210`, `3280579221`, `3280579226`, `3281567626`, `3281567723`) — markdown/RFC content; not code findings.

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

Update (2026-05-22, latest pass): two more Copilot threads synced and fixed — WPB3-021 (how-to said dict/list render with "no extra whitespace", but `json.dumps` default separators produce `{"x": 1, "y": 2}`; doc reworded), WPB3-022 (parent RFC/README still used the superseded "pre-render then re-render" framing for `{{$...}}` — WPB3-010 had only covered the wp-b3 doc set; reworded all occurrences in the parent docs to shield → render → substitute-last). Threads `3287741721` and `3287741764` resolved.

Update (2026-05-22, later pass): three new Copilot threads synced and fixed — WPB3-018 (`chatPrompts.ts` mustache regex missed `{{ name }}` inner whitespace; fixed + tested), WPB3-019 (`TokenPlugin.tsx` comment overstated "fstring fallback" coverage; comment corrected), WPB3-020 (`PromptTemplate.template_format` description called mustache the default while the field default is `curly`; description reworded). All three threads (`3287635462`, `3287635521`, `3287635556`) resolved.

Update (2026-05-22): all findings (WPB3-001..017) are fixed and Closed; there are no open findings, and all PR #4393 review threads are resolved. WPB3-014 (escape behavior) was closed via Option 3 — document the per-format reality now (delimiter swap / `{% raw %}` / none for curly; no backslash escape), defer a `\{{` escape pending real demand; full evidence and the tested `\{{` vs `\{\{` result are in `escape-analysis.md`, and the user-facing how-to gained an "Escaping" section. WPB3-017 (frontend `extractTemplateVariables` JSDoc omitted mustache) was fixed. 270 across the four focused suites pass; ruff clean. GitHub: 14 solved-by-content threads resolved (the WPB3-015 RFC cluster `3280747520`/`3280759652`/`3280767036`/`3280770190`/`3280772919`/`3280776786`/`3280781711`/`3280782719`/`3280579226`, the WPB3-016 how-to `3280800719`, and the scope/PR-title threads `3280751193`/`3280761180`/`3280794168`/`3281567723`); the only 3 left unresolved are the escape threads (`3280753760`, `3280788530`, `3280579221`) mapped to the open WPB3-014.

Finding lineage: WPB3-001..004 from the first scan; WPB3-005..007 from the 2026-05-22 re-scan; WPB3-008..011 (doc-only prose fixes — docstring/qa/pre-render-framing/`+++` markers); WPB3-012..013 (P2 cross-format error-contract bugs, fixed with tests); WPB3-014 (escape, OPEN); WPB3-015 (RFC library/deviation/requirement/security consolidation, `langchain_core` recorded as considered-and-rejected); WPB3-016 (draft `_mustache-templates.mdx` how-to). WPB3-008..016 are all from the PR #4393 sync.

- WPB3-004 (test gaps) and WPB3-003 (frontend coercion) fixed (2026-05-21).
- WPB3-001 + WPB3-002 (JSONPath `{{$...}}` handling) resolved together (2026-05-22) by unifying JSONPath across curly / mustache / jinja2: a shared `_render_with_jsonpath` resolves `{{$...}}` to a value, substitutes it into the rendered output last, and never re-parses it — exactly what `curly` already did, now extended to mustache and jinja2. Failure handling also matches `curly` (`UnresolvedVariablesError` for both missing and malformed `{{$...}}`). The interim `MUSTACHE_RENDER_ORDER` switch and `MustacheInvalidJsonPathError` were removed. Context-provenance analysis confirmed no OS-secret/env-var leak is possible (the render context is explicitly and narrowly constructed); the issue was the chain-of-replacement ordering surprise, now removed. Cross-format parity is pinned by `test_jsonpath_parity_across_formats` / `test_jsonpath_failure_parity_across_formats`.

## Notes (verified, no finding required)

- Re-scan (2026-05-22, fresh context, committed state on `feat/add-mustache-rendering`): leftover-symbol check clean — no references to the removed `MUSTACHE_RENDER_ORDER` or `MustacheInvalidJsonPathError` anywhere outside this findings file's history; no `_prerender_jsonpath_tags` leftovers. No dead imports: `Callable` and `resolve_json_path` are both used in `templating.py`. The `if not shielded: return rendered` early-out correctly covers the no-JSONPath common case (one mask-regex pass only). Error normalization holds end to end: a mustache IndexError, a jinja2 `UnresolvedVariablesError`, and a `MustacheTemplateError` all wrap to `TemplateFormatError` on the chat path and `PromptFormattingV0Error` on the judge path (verified at runtime) — no unwrapped escape. Triple-stache `{{{$.x}}}` resolves and is unescaped correctly. Whole-object `{{$.obj}}` inserts compact JSON and is not re-rendered. Sentinel survives mustache section iteration intact (`{{#users}}[{{$.x}}]{{/users}}` → `[V][V][V]`). Intent conformance verified: builtin `auto_ai_critique_v0` v5+mustache, all four evaluator presets v5+mustache + `settings_template` default mustache, catalog `template_format` enum includes mustache with default mustache, `llm_v0` legacy fallback stays `curly`, judge version map v2→fstring / v3-4→curly / v5→mustache. Frontend `resolveTemplateFormat` preserves mustache and is the single source of truth (molecule + utils). Intent conformance with WP-B3 and the prompt-unification design docs as a whole confirmed. The re-scan surfaced three low/medium findings (WPB3-005..007; no P0/P1), all since fixed (see Closed) — 161 render-helper / 268 four-suite tests pass; ruff clean.

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

### [CLOSED] WPB3-021 — How-to claimed dict/list render as compact JSON with "no extra whitespace"

- ID: WPB3-021
- Origin: sync (PR #4393, Copilot thread `3287741721`)
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Correctness (doc/impl mismatch)
- Summary: `_mustache-templates.mdx` said dict/list values render as "compact JSON (`{"x": 1}`, no extra whitespace)". The renderer uses `json.dumps(value, ensure_ascii=False)` (`templating.py:89`) with **default** separators, so the actual output is `{"x": 1, "y": 2}` — spaces after `:` and `,` (verified empirically). "No extra whitespace" and the `{"x": 1}` example were wrong.
- Fix applied: reworded the table row to "JSON via `json.dumps` (unicode preserved), e.g. `{"x": 1, "y": 2}`" and dropped the "no extra whitespace" claim. (Renderer unchanged — the doc was the error, not the code; matching `curly` is the intended behavior.)
- Files: `docs/docs/prompt-engineering/integrating-prompts/_mustache-templates.mdx` (value-coercion table).

### [CLOSED] WPB3-022 — Parent RFC/README still described `{{$...}}` as "pre-rendered, then re-rendered" (superseded model)

- ID: WPB3-022
- Origin: sync (PR #4393, Copilot thread `3287741764`)
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Consistency (doc/impl drift)
- Summary: WPB3-010 swept the "pre-render" framing from the **wp-b3** doc set, but the **parent** RFC (`prompt-runtime-unification/rfc.md`) and its mirror `README.md` still said `{{$...}}` tags are "pre-rendered as JSONPath expressions … then the resulting template is rendered with a Mustache engine" — implying JSONPath results are fed back through the engine. The implementation shields `{{$...}}` from the engine, renders, then substitutes resolved values **last** as inert data (never re-parsed); jinja2 additionally skips shielding inside `{% raw %}` / `{# #}`. The comment pinned rfc.md:124, but the same wrong framing repeated at rfc.md:263/296/342 and README.md:124/270/303/349/425.
- Fix applied: reworded every occurrence in both parent docs to the shield → render → substitute-last model ("resolved as JSONPath and substituted as inert data after the Mustache render, never re-parsed"). Also tightened wp-b3 `rfc.md:9` ("before the Mustache render runs" → substitute-last phrasing) for consistency.
- Files: `docs/design/prompt-runtime-unification/rfc.md`; `docs/design/prompt-runtime-unification/README.md`; `docs/design/prompt-runtime-unification/wp-b3-mustache-rendering/rfc.md`.
- Note: WPB3-010 was scoped to the wp-b3 doc set only; this is the same class of fix extended to the parent RFC/README that WPB3-010 did not cover.

### [CLOSED] WPB3-018 — `chatPrompts.ts` mustache regex missed `{{ name }}` (inner whitespace)

- ID: WPB3-018
- Origin: sync (PR #4393, Copilot thread `3287635462`)
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Correctness (variable extraction, frontend)
- Summary: `extractVariablesFromText` in `agenta-shared/chatPrompts.ts` used `/\{\{(\w+)\}\}/g` for mustache (and curly/jinja2), which does not match a tag with inner whitespace like `{{ name }}`. Mustache treats `{{ name }}` and `{{name}}` as equivalent (verified: both render `Ada`), and the new how-to says so, so token discovery (and downstream highlighting/autocomplete relying on `tokens`) silently missed spaced variables. The sibling extractor `runnable/utils.ts` already `.trim()`s the captured name, so this one was inconsistent with the rest of the codebase.
- Fix applied: allow optional surrounding whitespace in the `{{...}}` patterns — `/\{\{\s*(\w+)\s*\}\}/g` for mustache, curly, and jinja2 (kept consistent across the three that share `{{ }}` delimiters); fstring `{...}` left unchanged.
- Files: `web/packages/agenta-shared/src/utils/chatPrompts.ts` (`extractVariablesFromText` patterns).
- Verification: new whitespace cases in `agenta-entity-ui/tests/unit/chatPromptsMustache.test.ts` (exercises `extractVariablesFromText` via the public `extractPromptTemplateContext`); vitest green.

### [CLOSED] WPB3-019 — `TokenPlugin.tsx` comment claimed the default path covers an "fstring fallback"

- ID: WPB3-019
- Origin: sync (PR #4393, Copilot thread `3287635521`)
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Consistency (misleading comment, frontend)
- Summary: The default-branch comment in `buildRegexes` said it covers "the fstring fallback", but the default regexes only match `{{...}}` and not fstring's `{...}` placeholders. fstring is no longer offered in the picker (only mustache/jinja2 are), but legacy fstring prompts still route through this branch and genuinely do not highlight `{...}` — pre-existing and out of scope for this PR. The comment overstated coverage.
- Fix applied: removed the "(and the fstring fallback)" clause so the comment states reality — the default path is the `{{ }}` path for curly and mustache; fstring `{...}` highlighting is not handled here.
- Files: `web/packages/agenta-ui/src/Editor/plugins/token/TokenPlugin.tsx` (default-branch comment).
- Verification: `@agenta/ui` types:check + lint (no behavior change; comment only).

### [CLOSED] WPB3-020 — `PromptTemplate.template_format` description said mustache is the default while the field default is `curly`

- ID: WPB3-020
- Origin: sync (PR #4393, Copilot thread `3287635556`)
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Consistency (doc/code mismatch)
- Summary: The Pydantic field `template_format` defaults to `"curly"`, but its `description` called mustache the "default for new apps". A consumer constructing `PromptTemplate()` directly gets `curly`, so the description was misleading about what the model itself does. Mustache is the default applied by app-creation flows / engine interfaces (which set it explicitly), not by the model default.
- Fix applied: reworded the description to state the model default is `curly` (legacy compatibility) while app-creation flows / interfaces default to `mustache` when explicitly set.
- Files: `sdks/python/agenta/sdk/utils/types.py` (`template_format` field description).
- Verification: ruff format + ruff check clean (description string only; no behavior change).

### [CLOSED] WPB3-014 — Literal-`{{`/escape behavior (spec gap) — documented; backslash escape deferred

- ID: WPB3-014
- Origin: sync (PR #4393 — mmabrouk threads `3280753760` rfc.md:25, `3280788530` rfc.md:176; coderabbit `3280579221` research.md:178)
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-22) — Option 3 (document now, defer backslash escape)
- Category: Functionality / Completeness (spec gap)
- Summary: Reviewers asked how an author emits a **literal** `{{name}}`, whether `\{{` vs `\{\{` is handled, and about other problematic characters. Probes (our three engines + real `langchain_core` 1.2.7) confirmed there is **no backslash escape** anywhere: `\{{name}}` → `\Ada` (tag still expands); `\{\{name}}` suppresses the tag but leaves stray backslashes (not a clean literal). Neither mystace nor langchain/chevron implements a backslash escape; the spec mechanism is the delimiter swap (mustache) / `{% raw %}` (jinja2); curly has none.
- Decision: **Option 3.** No backslash escape now; the per-format reality is documented. Deferred: a `\{{` escape for curly via shield-and-substitute, gated on real demand (not scheduled). Full evidence + edge-case spec + options in `escape-analysis.md`.
- Fix applied: added an "Emitting literal `{{ }}` (escaping)" section to `_mustache-templates.mdx` (delimiter swap for mustache, `{% raw %}` for jinja2, none for curly); recorded the decision in `escape-analysis.md`.
- Files: `docs/docs/prompt-engineering/integrating-prompts/_mustache-templates.mdx`; `docs/design/prompt-runtime-unification/wp-b3-mustache-rendering/escape-analysis.md`.
- Library finding (answers `3280788530`): `langchain_core.utils.mustache` has zero backslash handling (`grep -c '\\' = 0`); mystace likewise. `\{{` is not a Mustache concept, so there is no reason to prefer `\{{` over `\{\{` — either would be a new non-standard deviation.

### [CLOSED] WPB3-017 — `extractTemplateVariables` JSDoc omitted mustache

- ID: WPB3-017
- Origin: sync (PR #4393, Copilot thread `3287283407`)
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Consistency (doc/code mismatch, frontend)
- Summary: `TemplateFormat` (`utils.ts:449`) includes `"mustache"` and `extractTemplateVariables` accepts it (mustache shares the curly/jinja2 `{{...}}` scan), but the JSDoc listed only curly / jinja2 / fstring — misleading about whether mustache is supported here.
- Fix applied: added a `"mustache": {{variableName}}` line to the JSDoc noting it shares the `{{...}}` extraction path, and updated the inline scan comment to "curly, jinja2, and mustache".
- Files: `web/packages/agenta-entities/src/runnable/utils.ts` (JSDoc + inline comment).
- Verification: `@agenta/entities` lint + `types:check` clean.

### [CLOSED] WPB3-015 — RFC did not consolidate the mystace rationale, deviations, JSONPath requirement, and security stance

- ID: WPB3-015
- Origin: sync (PR #4393 — mmabrouk threads `3280747520` rfc:22, `3280759652` rfc:33, `3280767036` rfc:57, `3280770190` rfc:59, `3280772919` rfc:67, `3280776786` rfc:69, `3280781711` rfc:53, `3280782719` rfc:108; coderabbit `3280579226` rfc:77)
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Completeness (RFC justification)
- Summary: The reviewers asked the RFC to (a) state the no-JSONPath-regression requirement, (b) explain what `mystace` gives for free vs what is rejected, and the security risks, (c) back the library claim with evidence rather than assertion, (d) state the "follow mustache to the letter" principle and any deviations, and (e) drop `langchain_core`. The data existed in `research.md` and the closed findings but `rfc.md` did not pull it together; mmabrouk's comments were pinned to pre-rewrite line numbers (langchain_core was already removed from the docs in commit `687c92498`).
- Fix applied: expanded `## Dependency Choice` in `rfc.md` to (1) summarize the `mystace` vs `chevron` benchmark and explicitly record `langchain_core` as considered-and-rejected (heavy/fast-moving, no JSONPath/JSON Pointer); (2) add `### Mustache Conformance and Deviations` stating the follow-to-the-letter principle and the three intentional deviations (`{{$...}}`, HTML-escape off, compact-JSON coercion); (3) add `### JSONPath Compatibility Requirement` (no regression vs curly, pinned by the parity tests); (4) add `### Security` (narrow context, no env/secret leak, never-re-parse removes cross-field echo).
- Files: `docs/design/prompt-runtime-unification/wp-b3-mustache-rendering/rfc.md` (`## Dependency Choice` and new subsections).
- Note: scope-acknowledgement threads (`3280751193` compact=JSON, `3280761180` frontend out of scope, `3280794168` judge-switch out of scope) and the PR-title thread (`3281567723`) are satisfied by current content/Non-Goals; left unresolved on GitHub pending user reply (no replies posted this pass).

### [CLOSED] WPB3-016 — No user-facing how-to for the mustache template format

- ID: WPB3-016
- Origin: sync (PR #4393, mmabrouk thread `3280800719` rfc:214)
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Documentation
- Summary: mmabrouk asked for a draft how-to (`_`-prefixed mdx) explaining how to use the format, modeled on the LangChain prompt-template-format guide.
- Fix applied: added `docs/docs/prompt-engineering/integrating-prompts/_mustache-templates.mdx` (draft, `_`-prefixed so it is excluded from the sidebar build) covering variables, sections, `{{$...}}` JSONPath (inert-data / never-re-parsed), value coercion, unsupported features (partials / empty placeholders / JSON Pointer), and a format-choice table. Links the LangChain guide as further reading.
- Files: `docs/docs/prompt-engineering/integrating-prompts/_mustache-templates.mdx` (new).
- Note: escape behavior is intentionally omitted from the how-to pending the WPB3-014 decision.

### [CLOSED] WPB3-012 — `_render_with_jsonpath` raised a mustache-named error on the jinja2 path (NUL byte)

- ID: WPB3-012
- Origin: sync (PR #4393, Copilot thread `3286943741`)
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Correctness (cross-format error contract)
- Summary: `_render_with_jsonpath` raised `MustacheTemplateError` for a NUL byte, but the helper is shared by both mustache and jinja2 (`_render_jinja2` calls it with `skip=_JINJA2_RAW_RE`). So `render_template(mode="jinja2", ...)` on a NUL-containing template raised a *mustache*-specific exception, which is surprising and made the `render_template` Raises contract misleading.
- Fix applied: the shared helper's NUL guard now raises a mode-agnostic `ValueError`; `_render_mustache` wraps a `ValueError` from the helper into `MustacheTemplateError` (re-raising `UnresolvedVariablesError` / `MustacheTemplateError` unchanged), so the mustache path keeps its subclass while jinja2 surfaces a plain `ValueError`. The `render_template` docstring's `ValueError` entry now notes the jinja2-NUL case.
- Files: `sdks/python/agenta/sdk/utils/templating.py` (NUL guard in `_render_with_jsonpath`; `ValueError`→`MustacheTemplateError` wrap in `_render_mustache`; docstring).
- Verification: `test_jinja2_nul_byte_raises_mode_agnostic_value_error` (jinja2 NUL raises `ValueError`, not `MustacheTemplateError`); existing `test_mustache_nul_byte_in_template_raises` still asserts the mustache path raises `MustacheTemplateError`. 270 across the four suites pass; ruff clean.

### [CLOSED] WPB3-013 — `_format_with_template` reported mustache/jinja2 `{{$...}}` failures as "curly template"

- ID: WPB3-013
- Origin: sync (PR #4393, Copilot thread `3286943795`)
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Correctness (error message accuracy)
- Summary: The `UnresolvedVariablesError` catch re-raised `TemplateFormatError("Unreplaced variables in curly template: ...")`. After the WPB3-001 unification, `UnresolvedVariablesError` also fires for mustache / jinja2 `{{$...}}` failures, so a mustache prompt's failure was reported as a curly error.
- Evidence: `types.py:816` AND `types.py:860` (the structured/messages path `_template_error_from_structured_error`) both hardcoded "curly template".
- Fix applied: interpolated `self.template_format` at both call sites — "Unreplaced variables in {format} template: ...".
- Files: `sdks/python/agenta/sdk/utils/types.py:816` (`_format_with_template`), `:860` (`_template_error_from_structured_error`).
- Verification: `test_mustache_unresolved_jsonpath_error_names_mustache_not_curly` (asserts "mustache template" present, "curly template" absent) — it exercised the structured path and caught the second occurrence the first edit missed. 270 across the four suites pass; ruff clean.

### [CLOSED] WPB3-011 — Root `rfc.md` used non-standard `+++` heading prefixes / separators

- ID: WPB3-011
- Origin: sync (PR #4393, Copilot threads `3280567210`, `3281567626`)
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Consistency (docs rendering)
- Summary: `docs/design/prompt-runtime-unification/rfc.md` prefixed headings with `+++` (e.g. `+++ ## Context`) and used standalone `+++` lines as separators — non-standard Markdown that renders as literal text and breaks heading anchors/TOC.
- Fix applied: stripped the prefix from 39 headings (`+++ ## X` → `## X`) and removed 39 standalone `+++` separator lines; collapsed resulting 3+ blank runs to one. 0 `+++` remain; 46 headings intact.
- Files: `docs/design/prompt-runtime-unification/rfc.md`

### [CLOSED] WPB3-010 — WP-B3 docs described the superseded "JSONPath pre-rendering" two-stage model

- ID: WPB3-010
- Origin: sync (PR #4393 review pass; found while triaging coderabbit/Copilot threads)
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Consistency (doc/impl drift)
- Summary: `README.md`, `research.md`, `plan.md`, `qa.md`, and `rfc.md` described `{{$...}}` handling as a *pre-rendering* stage that runs *before* the engine and feeds its output back through it ("WP-B3 now has two stages: 1. JSONPath pre-rendering ... 2. Mustache rendering"). The WPB3-001 redesign replaced that with shield-and-substitute: `{{$...}}` is shielded from the engine, the engine runs, then resolved values are substituted **last** (never re-parsed), uniformly across curly / mustache / jinja2. The "pre-render" framing was wrong and contradicted the closed WPB3-001/008.
- Evidence: the framing appeared across the wp-b3 doc set — `README.md:5`, `research.md:99,174-180,191`, `plan.md:20,34`, `qa.md:9,46,47,100`, `rfc.md:22,49,80-85,135,217`.
- Fix applied: reframed the contract docs (README, research, plan, qa, rfc) as shield-and-substitute — explicit three-step (shield / render / substitute-last), "never re-parsed", and "unified across curly / mustache / jinja2"; swept the residual "pre-render(ing)" wording to "JSONPath resolution". Left `status.md` dated log/decision entries as historical record (accurate at the time; the redesign is captured by later entries + this findings doc).
- Files: `README.md`, `research.md`, `plan.md`, `qa.md`, `rfc.md` (wp-b3 doc set).
- Verification: `grep` confirms no wrong "pre-render" framing remains in the contract docs (only the one intentional "it is NOT a pre-render stage" clarifier in `research.md:180`).

### [CLOSED] WPB3-008 — `render_template` docstring Raises section was stale re unresolved `{{$...}}`

- ID: WPB3-008
- Origin: sync (PR #4393, Copilot thread `3286635303`)
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Correctness (doc/impl mismatch)
- Summary: The `render_template` docstring said `MustacheTemplateError` is raised for "an unresolved JSONPath pre-render tag". After the WPB3-001/002 redesign, an unresolved `{{$...}}` (missing or malformed) is surfaced as `UnresolvedVariablesError`, uniform across curly / mustache / jinja2. The docstring still described the pre-redesign contract and the dropped "pre-render" framing.
- Fix applied: rewrote the Raises section — `MustacheTemplateError` now covers unsupported partials, empty placeholders, JSON Pointer tags, NUL bytes, and mystace parse errors; `UnresolvedVariablesError` now covers unresolved curly placeholders AND `{{$...}}` JSONPath failures across mustache / jinja2 / curly. "Pre-render" wording removed.
- Files: `sdks/python/agenta/sdk/utils/templating.py:324-330`
- Verification: ruff format/check clean on `templating.py`.

### [CLOSED] WPB3-009 — QA plan claimed missing top-level var raises; implementation is permissive

- ID: WPB3-009
- Origin: sync (PR #4393, Copilot thread `3286635369`)
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Consistency (doc/impl mismatch)
- Summary: `qa.md` listed "missing top-level variable raises a clear Mustache formatting error" under Grumpy Paths. The implementation deliberately keeps mustache permissive — a missing `{{var}}` renders empty (mystace default). Only `{{$...}}` JSONPath failures, partials, empty/whitespace placeholders, JSON Pointer tags, and NUL bytes raise.
- Fix applied: reworded the bullet to "missing top-level variable renders empty (mustache is permissive)" and scoped the adjacent JSONPath bullet to "missing or malformed JSONPath `{{$...}}` expression raises".
- Files: `docs/design/prompt-runtime-unification/wp-b3-mustache-rendering/qa.md:155-156`
- Verification: matches the pinned render-helper tests for permissive missing-var behavior.

### [CLOSED] WPB3-005 — Jinja2 `{% raw %}` / `{# #}` did not suppress `{{$...}}` JSONPath tags (raw-block contract)

- ID: WPB3-005
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Correctness (cross-format soundness)
- Summary: The JSONPath unification shielded `{{$...}}` tags *before* the engine ran, so for jinja2 a `{{$...}}` inside `{% raw %}...{% endraw %}` or a `{# ... #}` comment was JSONPath-resolved even though the appendix raw-block contract says raw blocks emit contents verbatim and comments are dropped. An author could not emit a literal `{{$.foo}}` in jinja2, and a failing `{{$...}}` inside a raw block/comment could raise.
- Fix applied: `_render_with_jsonpath` gained a `skip` parameter (a compiled regex of spans to leave for the engine); `_render_jinja2` passes `_JINJA2_RAW_RE` matching `{% raw %}...{% endraw %}` and `{# ... #}`, so `{{$...}}` inside those spans is left untouched and handled by jinja2 natively. Mustache passes no `skip` (it has no equivalent verbatim region).
- Verification: `{% raw %}{{$.x}}{% endraw %}` → `'{{$.x}}'`; `a {# {{$.x}} #} b` → `'a  b'`; a failing `{{$.nope}}` inside raw/comment no longer raises; `{{$.x}}` outside raw still resolves. Tests: `test_jinja2_raw_block_emits_jsonpath_tag_verbatim`, `test_jinja2_comment_does_not_resolve_jsonpath_tag`, `test_jinja2_jsonpath_outside_raw_still_resolves`.

### [CLOSED] WPB3-006 — NUL-sentinel collision in template text

- ID: WPB3-006
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Soundness
- Summary: The JSONPath shield used `\x00JP<n>\x00` sentinels; a template literally containing that text plus a real `{{$...}}` tag would be silently corrupted or raise an opaque (but wrapped) IndexError. The "sentinel cannot occur in prompt text" assumption was unenforced; curly was unaffected (asymmetry).
- Fix applied: `_render_with_jsonpath` rejects any template containing a NUL byte (`\x00`) up front with a clear `MustacheTemplateError`. NUL cannot occur in a real prompt, so this eliminates both the corruption and the IndexError and enforces the sentinel assumption.
- Verification: a template with `\x00` raises immediately. Test: `test_mustache_nul_byte_in_template_raises`.

### [CLOSED] WPB3-007 — Mustache `{{/a/b}}` JSON-Pointer tag gave an opaque `mystace` error

- ID: WPB3-007
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed (2026-05-22)
- Category: Functionality (error quality)
- Summary: JSON Pointer is intentionally unsupported in mustache (RFC), but `{{/obj/k}}` produced a cryptic `mystace` "Opening tag" error instead of a clear product message.
- Fix applied: `_reject_unsupported_mustache_tags` detects a body starting with `/` that contains an inner `/` (a JSON Pointer, e.g. `/obj/k`) and raises a clear "JSON Pointer is not supported in mustache templates …" message. A bare section close `{{/x}}` (no inner `/`) is left to the engine, so valid `{{#x}}…{{/x}}` sections are unaffected.
- Verification: `{{/obj/k}}` raises with "JSON Pointer" in the message; `{{#x}}hi{{/x}}` still renders `hi`. Tests: `test_mustache_json_pointer_raises_clear_error`, `test_mustache_section_close_is_not_mistaken_for_json_pointer`.

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
- Status: fixed (test names reconciled 2026-05-22 after the WPB3-001 JSONPath redesign)
- Category: Testing
- Summary: The new suites covered happy paths, parity, partials, and version defaults, but the riskiest behaviors were untested. Tests have been added and (after the JSONPath unification) updated to assert the final behavior. Current counts: Python `test_render_template_helper.py` 155 passing (262 across the four focused suites); frontend entity-ui vitest 11 passing.
- Tests added (current names, post-redesign):
  - Ampersand-unescape `{{&var}}`: `test_mustache_ampersand_is_unescaped` (section 10) + a `{{&h}}` row in the engine-parity table (`test_mustache_engine_parity_contract`), so a future engine swap is caught.
  - `$`-prefixed / malformed JSONPath: `test_mustache_malformed_jsonpath_is_treated_as_unresolved_like_curly` (`{{$id}}` over a `$id` key raises `UnresolvedVariablesError`, matching curly) — replaced the interim strict-contract test when WPB3-002 was finalized to match curly.
  - JSONPath non-recursion (WPB3-001): `test_mustache_jsonpath_value_is_not_rendered_recursively` and `test_mustache_jsonpath_whole_object_insertion_is_not_re_rendered` assert the resolved value stays literal — replaced the earlier change-detector that pinned the (now-removed) recursive behavior.
  - Unresolved JSONPath: `test_mustache_unresolved_jsonpath_raises_like_curly`.
  - jinja2 JSONPath (section 16): field/root/list/object, `test_jinja2_jsonpath_value_is_not_rendered_recursively`, `test_jinja2_jsonpath_alongside_native_tags`, `test_jinja2_unresolved_jsonpath_raises_like_curly`, `test_jinja2_malformed_jsonpath_is_treated_as_unresolved_like_curly`.
  - Cross-format parity (section 17): `test_jsonpath_parity_across_formats` and `test_jsonpath_failure_parity_across_formats` run the same inputs through curly+mustache+jinja2 and assert identical output / identical failure.
  - Frontend mustache recognition (`chatPrompts.ts`): `web/packages/agenta-entity-ui/tests/unit/chatPromptsMustache.test.ts` asserts `extractPromptTemplateContext` preserves a stored `mustache` format (snake_case and camelCase), extracts `{{var}}` tokens, and still defaults to `curly` when no format is declared.
- Files:
  - `sdks/python/oss/tests/pytest/unit/test_render_template_helper.py` (sections 10, 12, 15, 16, 17)
  - `web/packages/agenta-entity-ui/tests/unit/chatPromptsMustache.test.ts` (new)
- Verification: `.venv` pytest 155 (render-helper) / 262 (four suites) passed; ruff format/check clean; entity-ui vitest 11 passed; `pnpm lint-fix` clean.
- Residual (intentionally not added): `PromptSchemaControl.tsx`'s `resolvedTemplateFormat` is an inline `useMemo` inside a React component and is not pure-testable without extracting it; extraction was judged out of proportion to a P2 and the logic is already correct (recognizes `mustache`, sensible fallback). The delimiter-swap × pre-render interaction remains parity-table-only.
