# Mustache section support in the editor

**Created:** 2026-06-02
**Status:** RFC — decisions locked, ready to implement Phase 1 (folding into PR #4465)
**Related:** [`project_mustache_wp_b3`](../../) (WP-B3 backend/SDK), [`project_playground_mustache_input_ux`](../../)
**Authors:** Arda

---

## Summary

PR #4465 (`fe-feat/mustache-support`) added Mustache as a fourth
`template_format` alongside `curly`, `fstring`, `jinja2`. The editor
tokenizes plain variables and the three name-bearing prefix sigils
(`#` section opener, `^` inverted section opener, `&` unescaped variable).
QA on 2026-06-02 (Mahmoud) surfaced a structural gap: section CLOSE tags
(`{{/repo}}`) render as plain text, and bare variables INSIDE a section
get registered as separate top-level variables when semantically they're
scoped to the section context.

This doc scopes the work to close that gap in two phases:
- **Phase 1 (this PR)** — tokenize close tags + remove phantom inner-variable
  discovery + exclude implicit iterator. No scope tracking yet.
- **Phase 2 (follow-up PR)** — real section parser + scoped discovery +
  array-of-objects schema inference + form-array editing.

JP's position (1780397247, "detect mustache keys but skip context inspection
and leave that to the runtime engine") and Mahmoud's complaint (1780397289,
"`name` inside `{{#repo}}` is actually `repo.name`") map cleanly to those
two phases.

---

## Current state

### Editor tokenization (`web/packages/agenta-ui/src/Editor/plugins/token/TokenPlugin.tsx`)

Mustache regex (after JP's `17df11cca3` regression fix on 2026-06-01):

```
(?<!\{)\{\{\s*(?![/!=>])(?=[^{}\s])[^{}]*\}\}
```

| Form | Tokenized? | Notes |
|---|---|---|
| `{{name}}` | ✅ | Plain variable |
| `{{ name }}` | ✅ | Whitespace-tolerant |
| `{{country.a}}` | ✅ | Dotted path |
| `{{$.country}}` | ✅ | JSONPath |
| `{{#section}}` | ✅ | Section opener — needed so typeahead anchors |
| `{{^section}}` | ✅ | Inverted opener — same reason |
| `{{&variable}}` | ✅ | Unescaped variable |
| `{{/section}}` | ❌ | **Plain text** — the gap Mahmoud is pointing at |
| `{{!comment}}` | ❌ | Plain text by design |
| `{{=<% %>=}}` | ❌ | Delimiter swap; plain text |
| `{{>partial}}` | ❌ | Plain text |
| `{{{name}}}` | ❌ | Triple-stash; rejected by `(?<!\{)` lookbehind |
| `{{.}}` | ⚠️ | **Tokenizes** as variable named `.` — wrong |

### Variable discovery walker

The walker that turns prompt text into the list of variable cards is *not*
scope-aware. It collects every tokenized name. So `{{#repo}}{{name}}{{/repo}}`
yields TWO top-level variables: `repo` and `name`. The user gets two cards;
filling `name` does nothing because the runtime renderer resolves `name`
inside the `repo` iteration scope, not at the top level.

### What the runtime actually does

The backend renders Mustache via the Python `chevron` library. It honors:
- `{{#x}}…{{/x}}` — iterate when `x` is array; render once when `x` is
  truthy non-array; skip when falsy/empty.
- `{{^x}}…{{/x}}` — render only when `x` is falsy/empty.
- `{{.}}` — implicit iterator (current context).
- `{{{x}}}` / `{{&x}}` — unescaped.
- `{{!cmt}}` — comment, rendered as empty.
- `{{>partial}}` — partial; we don't ship a partial registry, so backend
  also rejects/ignores in practice.

So the runtime is fully Mustache-spec — the FE is the divergent surface.

---

## Phase 1 — Editor UX + discovery defang

Goal: stop misleading the user, without committing to scope tracking yet.
**Folds into PR #4465** (decision: ship gate = current PR).

### 1a. Tokenize structural close + comment + partial + delimiter

Extend the mustache regex to also accept `{{/name}}`, `{{!comment}}`,
`{{=<% %>=}}`, `{{>partial}}`. Drop the `(?![/!=>])` exclusion from the
post-`{{` lookahead. Net effect: every well-formed mustache tag becomes a
TokenNode; only triple-stash and empty `{{}}` stay rejected.

Visual style: **same blue as variable tokens — the sigil carries the
meaning** (decision locked). No second token color. Less visual noise,
matches how users already read Jinja blocks.

Implementation:
- Update three regexes in `buildRegexes()` for the `mustache` branch:
  `FULL_TOKEN_REGEX`, `TOKEN_INPUT_REGEX`, `EXACT_TOKEN_REGEX`.
- No changes to `TokenNode` rendering — same node class, same className.

### 1b. Discovery walker — drop phantom inner variables

Find the walker (likely lives near `prompt → variable list` derivation; the
schema-inference step that produces inputs for the testcase columns). Walk
tokens in order, maintain an open-stack of unclosed `#` / `^` openers.
While the stack is non-empty, SKIP every bare variable token. Discovery
output for `{{#repo}}{{name}}{{/repo}}{{country}}`:

```
['repo', 'country']
```

Note: `repo` IS discovered (it's a variable in its own right — the section
needs a value from the user). `name` is NOT (it's scoped to `repo` and we
don't model that yet). `country` IS (it's outside the section).

Documented contract for the user: *"For Mustache sections, we collect a
single input for the section variable. Inside the section, fill the value
as raw JSON (an array of objects, an object, or a primitive — whatever
your template expects)."* This matches JP's "skip context inspection" line.

### 1c. Exclude implicit iterator

Tighten the regex so `{{.}}` is NOT tokenized. Simplest fix: extend the
post-`{{` lookahead to also reject `.` when it's the *only* content:

```
(?![/!=>.])
```

Doesn't break `{{.foo}}` (lookahead is at position 0; `.foo` starts with
`.` which would be rejected). Actually that's wrong — `{{.foo}}` isn't
valid Mustache anyway (would need to be `{{this.foo}}` or just `{{foo}}`).
So rejecting any `.`-starting content is fine. The narrower form
`(?!\.\s*\}\})` rejects only `{{.}}` / `{{ . }}` and leaves the rest.

Decision: narrower form — `(?!\.\s*\}\})` — minimal blast radius.

### 1d. No typeahead changes in Phase 1

Tokenizing close tags will make `TokenTypeaheadPlugin` try to suggest
variable names for `{{/x}}`. Two options:

- **Suppress typeahead inside `{{/`** — detect the `/` sigil, return no
  suggestions. Simple.
- **Suggest the matching opener** — walk the AST backward, maintain a
  stack, suggest the top unclosed open name. Phase-2 territory.

Phase 1: suppress. One-line check in the typeahead anchor.

### 1e. Phase 1 acceptance

For prompt: `{{#repo}}{{name}}{{/repo}}{{country.a}}`

- Editor highlights: `{{#repo}}`, `{{name}}`, `{{/repo}}`, `{{country.a}}` — four blue tokens.
- Variable cards shown: `repo`, `country`.
- Typeahead inside `{{/...}}`: empty (no suggestions).
- `{{.}}` (added anywhere): renders as plain text.

---

## Phase 2 — Scope-aware discovery (follow-up PR)

Goal: address Mahmoud's `name` → `repo.name` complaint properly.
**Separate PR off `main` after #4465 lands.**

### 2a. Real section parser

Replace the regex-based discovery with a proper parser. A regex CAN'T
handle nested sections (`{{#a}}…{{#b}}…{{/b}}…{{/a}}`) — needs a stack.

Output shape:

```ts
type MustacheNode =
  | { kind: 'text'; value: string }
  | { kind: 'variable'; name: string; escape: boolean }
  | { kind: 'section'; name: string; inverted: boolean; children: MustacheNode[] }
  | { kind: 'comment'; value: string }
  | { kind: 'partial'; name: string }
```

Location: `web/packages/agenta-shared/src/mustache/parser.ts` — shared
between the editor (token-class assignment, validation), discovery (variable
list + nested paths), and schema inference.

Existing libs to consider before writing our own: `mustache` (JS), `hogan.js`,
`Handlebars.parse`. Decision deferred to Phase-2 design pass; lean toward
adopting `mustache`'s parser if it exposes the AST cleanly, otherwise hand-roll
(~150 LOC).

### 2b. Scoped variable discovery

Walk the AST. Track a path stack as we descend into sections:

```
{{#repo}}{{name}}{{/repo}}{{country}}
↓ AST walk
- enter section 'repo' → stack: ['repo']
  - variable 'name' → emit 'repo.name'
- exit section 'repo' → stack: []
- variable 'country' → emit 'country'
```

Discovery output is now a *path tree*, not a flat list:

```
{
  repo: { _isSection: true, _children: { name: { type: 'string' } } },
  country: { type: 'string' }
}
```

The top-level variable cards still render only top-level names. The nested
structure feeds schema inference + Form view.

### 2c. Schema inference — array of objects default

For `{{#repo}}{{name}}{{/repo}}`:

```ts
{
  type: 'object',
  properties: {
    repo: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' } } }
    }
  }
}
```

**Decision locked: array of objects** (vs single object). Mustache iterates
arrays — that's the common case. Single-object case still works at runtime
because Mustache treats a non-array truthy value as a one-element iteration.
A single object filled in the array view becomes `[{...}]` → same render
output for the user's template.

For `{{^empty}}…{{/empty}}` (inverted section): same shape. User fills the
data anyway; section just doesn't render unless `empty` is falsy/empty.

### 2d. Form view for array-of-objects sections

`buildEmptyShapeFromSchema` extended to detect array-of-objects from
`items.type === 'object'` + `items.properties`, return `[]` as the
empty shape but seed one row when the user clicks `+ add row`.

`FormView` already renders objects. Need an array wrapper: row-list with
`+ add row` / `× remove row` controls. Each row is a `FormView<object>`.

Stash/conflict pattern from the recent commits (`buildSchemaStrictShape`,
`mergeEditWithStash`, the unused-keys footer) applies here too. When the
user renames `{{#repo}}{{name}}{{/repo}}` to `{{#repo}}{{title}}{{/repo}}`,
the old `name` values stash inside each row, the footer surfaces them.

### 2e. Editor validation — unbalanced sections

**Decision locked: editor warning on the offending token.** Implementation:

- Run the parser on every editor update (debounced).
- On unbalanced detection, attach a `validationError` decoration to the
  offending TokenNode: amber underline + tooltip ("unclosed section `repo`"
  or "closing `b` doesn't match nearest open `a`").
- Doesn't block save / commit — backend will reject at render time anyway;
  this is a UX nudge.

### 2f. Out-of-scope corner cases (document, don't implement)

- **Lambdas**: Mustache sections where the value is a function. Runtime
  concern. FE treats sections uniformly as array-or-truthy.
- **Partials** (`{{>x}}`): no partial registry on the FE. Token recognized
  in Phase 1, but variable list excludes them.
- **Delimiter swap** (`{{=<% %>=}}`): legacy mustache feature. Token
  recognized in Phase 1, ignored by discovery.
- **Triple-stash** (`{{{x}}}`): backend handles it identically to `{{&x}}`.
  FE recommends users write `{{&x}}` — easier to read, same semantics.

---

## Decisions locked (this RFC)

| # | Decision | Choice |
|---|---|---|
| 1 | Section schema default (Phase 2) | **Array of objects** (`repo: [{name: ""}]`) |
| 2 | Phase 1 ship gate | **Fold into current PR #4465** |
| 3 | Visual style for structural tokens | **Same blue color; sigil carries meaning** |
| 4 | Unbalanced-section error surface | **Editor warning on the offending token** |
| 5 | Implicit iterator `{{.}}` (Phase 1) | **Exclude from tokenization** |

## Open questions (Phase 2 only)

- **Parser source**: adopt `mustache.js`'s parser or hand-roll? Deferred
  to Phase 2 design pass once we've poked at `mustache.js`'s AST shape.
- **Array empty-state UX**: when `repo` is `[]`, do we render a single
  empty row by default or an actual empty-state CTA (`+ add row`)? Lean
  CTA — keeps the form honest about "no rows yet".
- **Nested section discovery beyond depth 1**: `{{#org}}{{#users}}{{name}}{{/users}}{{/org}}`
  → `org.users[i].name`. Phase 2a's parser handles this naturally; just
  call it out so we test it.

---

## Implementation order (Phase 1)

1. Extend mustache regex in `TokenPlugin.tsx` (1a + 1c, ~10 LOC).
2. Find the variable-discovery walker, add open-stack skip (1b, ~30 LOC).
3. Suppress typeahead inside `{{/...}}` (1d, ~5 LOC).
4. Manual QA: type the test prompt from §1e, verify variable cards.
5. Commit and push on top of `fe-feat/mustache-support`.

## Implementation order (Phase 2 — new PR, after #4465 merges)

1. New branch off `main`.
2. Pick parser strategy (lib vs hand-roll), build `web/packages/agenta-shared/src/mustache/parser.ts`.
3. Scope-aware discovery (2b).
4. Schema inference array default (2c) + `buildEmptyShapeFromSchema` array handling.
5. Form-array editor (2d) reusing the existing stash/conflict machinery.
6. Editor validation decorations (2e).
7. QA pass with Mahmoud's `{{#repo}}{{name}}{{/repo}}` example.
