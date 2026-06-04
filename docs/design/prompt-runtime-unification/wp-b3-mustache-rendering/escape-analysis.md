# Escape Behavior Analysis (WPB3-014)

Standalone analysis for the three PR #4393 escape threads. Maps to finding WPB3-014. It gathers the evidence (reference-engine behavior + live probes), then records the decision (see Decision, below).

## The three comments

1. **coderabbit — `research.md:178` (`3280579221`).** "Clarify escaping implementation edge cases." Assumes a backslash-escape (`\{{` → literal `{{`) and asks the spec to define: double backslash (`\\{{name}}`), order of operations (sentinel vs other), and escaped-delimiter-then-real-placeholder (`\{{example\}} and {{name}}`). Proposes a "protect → render → restore" sentinel implementation.

2. **mmabrouk — `rfc.md:25` (`3280753760`).** "Might be worth first agreeing/specifying how the escape behavior will look in general." A request to *define the contract first*, before implementing.

3. **mmabrouk — `rfc.md:176` (`3280788530`).** "Any reason for `\{{` instead of `\{\{`? What does langchain_core implement in this case? What about other problematic characters?"

Common root: an **earlier** version of the WP-B3 docs proposed a `\{{` backslash escape. That proposal was removed in commit `687c92498` ("fix CR"), so the comments now point at a contract that no longer exists. The threads are really one open question: **should an author be able to emit a literal `{{...}}`, and if so how?**

## What the implementation does today (probed 2026-05-22)

Literal `{{name}}` attempts, context `{"name": "Ada"}`:

| Input | mustache | curly | jinja2 |
| --- | --- | --- | --- |
| `\{{name}}` | `\Ada` | `\Ada` | `\Ada` |
| `\\{{name}}` | `\\Ada` | `\\Ada` | `\\Ada` |
| `\{\{name}}` | `\{\{name}}` | `\{\{name}}` | `\{\{name}}` |
| `{{{{name}}}}` | `}` | raises `UnresolvedVariablesError` | raises `TemplateSyntaxError` |
| `{{=<% %>=}}{{name}}` (delimiter swap) | `{{name}}` | raises `UnresolvedVariablesError` | raises `TemplateSyntaxError` |
| `{% raw %}{{name}}{% endraw %}` | n/a | n/a | `{{name}}` |

Takeaways:

- **No backslash escape anywhere.** `\{{` emits a literal backslash and still expands the tag.
- **mustache** can emit literal braces via the **standard Mustache delimiter swap** (`{{=<% %>=}}` switches delimiters so `{{name}}` becomes literal text). You can swap back afterward to render real tags.
- **jinja2** has a real escape: the native `{% raw %}...{% endraw %}` block (already honored by our shielding — see WPB3-005).
- **curly** has **no** escape mechanism at all.
- So today the three formats are inconsistent, and only mustache (awkwardly) and jinja2 (cleanly) can emit literal braces.

## How the reference libraries solve it

### mystace 1.0.1 (our engine)

Source inspection (`tokenize.py`) + probe: mystace recognizes only the standard Mustache sigils (`! # ^ / > = & {`). **No backslash escape.** The Mustache-spec way to emit literal braces is the **set-delimiter tag** (`{{=<% %>=}}`). Confirmed: `{{=<% %>=}}{{name}}` → `{{name}}`.

### langchain_core.utils.mustache

Confirmed two ways:

- **Source** (adapted from `chevron`, MIT; checked at master and at the pinned commit `a1e2daf`): `grep -c '\\'` = **0** — no backslash handling whatsoever. Supports the standard sigils (`! # ^ / > = { &`) plus set-delimiter. Empty/unclosed tags raise `ChevronError`.
- **Empirical** (real `langchain_core` 1.2.7, run 2026-05-22):

  | Input (ctx `{"name":"Ada"}`) | langchain output |
  | --- | --- |
  | `{{name}}` | `Ada` |
  | `\{{name}}` | `\Ada` (backslash literal, tag still expands) |
  | `\\{{name}}` | `\\Ada` |
  | `\{{name\}}` | `\` (the trailing `\}}` corrupts the tag — not a clean literal) |
  | `{{=<% %>=}}{{name}}` | `{{name}}` (delimiter swap works) |
  | `{{{name}}}` | `Ada` |
  | `{{}}` | raises `ChevronError: empty tag` |
  | `{{name` | raises `ChevronError: unclosed tag` |

So the direct answer to comment #3 ("what does langchain_core implement for `\{{`?"): **nothing.** `\{{` emits a literal backslash and still expands the tag; neither `\{{` nor `\{\{` is a langchain concept. The only literal-brace mechanism is the spec delimiter swap, exactly like mystace. Empty/unclosed tags raise `ChevronError` (we reject the same cases with `MustacheTemplateError`).

### Conclusion on the library question

Neither candidate implements a backslash escape. **`\{{` is not a Mustache concept**; it was an Agenta-proposed extension. "Following Mustache to the letter" (the WPB3-015 principle) points to the **delimiter swap** as the canonical answer for mustache, and there is no reason to prefer `\{{` over `\{\{` because neither is standard — inventing either would be a *fourth* deviation beyond the three we deliberately allow.

## `\{{` vs `\{\{` (comment `3280788530`, directly tested)

mmabrouk asked whether the escape would be `\{{` (one backslash before the doubled brace) or `\{\{` (a backslash before each brace). Probed across our three engines **and** real `langchain_core` 1.2.7 — all four behave identically:

| Input (ctx `{"name":"Ada"}`) | Output | Effect |
| --- | --- | --- |
| `\{{name}}` | `\Ada` | backslash literal, **tag still expands** — no escape |
| `\{\{name}}` | `\{\{name}}` | literal, **tag does NOT expand**, but backslashes remain |
| `\{\{name\}\}` | `\{\{name\}\}` | fully literal, backslashes remain |

Why `\{\{` differs: the `\` *between* the braces means the literal substring `{{` never occurs, so the tokenizer never sees an opening delimiter and the text passes through verbatim. This is **not an escape feature** — it is a side effect of breaking the `{{` token, and it leaves the backslashes in the output (you get `\{\{name}}`, not a clean `{{name}}`).

Answer to the question: **neither is a real escape.** `\{{` does nothing; `\{\{` accidentally suppresses the tag but corrupts the text with stray backslashes. This is engine-universal (mustache/curly/jinja2/langchain all agree), confirming there is no backslash-escape convention to inherit. The only clean literal-brace mechanism is the delimiter swap (mustache) / `{% raw %}` (jinja2).

## "Other problematic characters" (comment #3)

Probed behavior worth pinning down regardless of the escape decision:

- **Empty / whitespace tag** `{{}}`, `{{   }}` — we already reject with `MustacheTemplateError` (matches langchain's `ChevronError`). ✔ defined.
- **JSON Pointer** `{{/a/b}}` — we reject with a clear message (WPB3-007). ✔ defined.
- **NUL byte** — rejected (WPB3-006 / WPB3-012). ✔ defined.
- **Unbalanced braces** `{{{{name}}}}` — mustache yields `}`; curly/jinja2 raise. Undefined/surprising, but an extreme edge; not worth special-casing.
- **`{{$...}}` containing braces in the resolved value** — inserted inert, never re-parsed (WPB3-001). ✔ defined.

The only genuine gap is "emit a literal `{{...}}`".

## Options

### Option 1 — Document the per-format reality (no code change)

State the supported escape per format and declare backslash unsupported:

- **mustache**: use the delimiter swap, e.g. `{{=<% %>=}}` ... `<%={{ }}=%>` to bracket literal regions.
- **jinja2**: use `{% raw %}...{% endraw %}`.
- **curly**: no escape; if a prompt must contain literal `{{...}}`, author it in mustache or jinja2.

Add the rows to `_mustache-templates.mdx` and a short "Escaping" subsection to `rfc.md`/`research.md`.

- Pros: zero code, fully spec-compliant, matches both reference libraries, no new deviation.
- Cons: delimiter swap is verbose/obscure; curly has no answer; cross-format inconsistency remains; doesn't satisfy reviewers who expected a simple `\{{`.

### Option 2 — Add a `\{{` backslash escape (mustache + curly), shielded like JSONPath

Reuse the existing shield-and-substitute machinery (the same pattern as `{{$...}}`):

1. Before render, replace `\{{` and `\}}` with NUL sentinels (distinct from the JSONPath sentinel namespace).
2. Render via the engine.
3. Restore sentinels to literal `{{` / `}}` last.

Define the edge cases coderabbit asked for (these are the *proposed* behaviors of a hypothetical escape, not what any engine does today — cf. the current-behavior tables above, where `\{{name\}}` renders `\`):

- `\{{name\}}` → literal `{{name}}`.
- `\\{{name}}` → `\` + rendered value (first backslash escapes the second; only a single backslash immediately before `{{`/`}}` escapes).
- `\{{a\}} and {{b}}` → literal `{{a}}` + ` and ` + rendered `b` (escaping is delimiter-pair-local).
- jinja2 keeps `{% raw %}` as its escape (don't double-define); decide whether `\{{` is also honored there for consistency.

- Pros: simple/uniform author experience; works in curly too; cross-format consistency if applied to all three.
- Cons: a **fourth, non-standard deviation** from Mustache (contradicts the WPB3-015 "to the letter" principle); neither mystace nor langchain does this; new surface area + edge-case tests; interacts with the existing NUL guard (WPB3-006) and the JSONPath shield (must not collide).

### Option 3 — Hybrid: document now, defer backslash

Ship Option 1 documentation now (closes the contract question and unblocks the PR), and capture Option 2 as a separate future enhancement gated on real user demand for literal braces in curly.

- Pros: unblocks the PR with a defined, spec-compliant contract; keeps the door open without committing to a deviation.
- Cons: leaves curly without an escape until/unless Option 2 ships.

## Recommendation

**Option 1 (or Option 3 if we want to leave the door open).** Both reference engines and the WPB3-015 "follow Mustache to the letter" principle point at the delimiter swap / `{% raw %}` as the canonical escapes; a backslash escape would be a new non-standard deviation that neither mystace nor langchain supports. If literal-`{{` in *curly* turns out to be a real user need, revisit Option 2 as a deliberate, separately-specced extension.

## Decision

**Option 3 (document now, defer the backslash escape)** — chosen 2026-05-22.

Now:

- No backslash escape. The supported way to emit literal `{{...}}` is documented per format: mustache → delimiter swap (`{{=<% %>=}}` … `<%={{ }}=%>`); jinja2 → `{% raw %}…{% endraw %}`; curly → none (author such prompts in mustache or jinja2). This is captured in the `_mustache-templates.mdx` how-to ("Escaping" section).
- Rationale: matches both reference engines (mystace and langchain/chevron implement no backslash escape) and the WPB3-015 "follow Mustache to the letter" principle. A backslash escape would be a fourth, non-standard deviation.

Deferred (revisit only on real demand):

- A `\{{` backslash escape for curly (Option 2), implemented via the existing shield-and-substitute machinery, with the edge cases specified above. Gated on evidence that users need literal `{{` in curly specifically (mustache/jinja2 already have mechanisms). Not scheduled.
