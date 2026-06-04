# Mustache section support in the editor

**Created:** 2026-06-02
**Status:** **Phase 1 + Phase 2a–2d shipped in PR #4465, plus the
nested section-opener inference fix.** Only Phase 2e (editor validation
decorations) remains as a follow-up.
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

The original plan split the work in two phases:
- **Phase 1 (this PR)** — tokenize close tags + remove phantom inner-variable
  discovery + exclude implicit iterator. No scope tracking.
- **Phase 2 (follow-up PR off main)** — real section parser + scoped
  discovery + array-of-objects schema inference + form-array editing +
  editor validation.

**What actually shipped (delta from the original plan):** Phase 1 AND
the scope-aware foundation pieces of Phase 2 (2a parser, 2b discovery,
2c schema inference, 2d form-array editor) all folded into PR #4465,
plus the **nested section-opener inference** fix that was originally
deferred to a follow-up PR. Only **Phase 2e (editor validation
decorations)** remains for a separate PR.

JP's position (1780397247, "detect mustache keys but skip context inspection
and leave that to the runtime engine") and Mahmoud's complaint (1780397289,
"`name` inside `{{#repo}}` is actually `repo.name`") map cleanly to the
phasing.

---

## Ship status (PR #4465 commits)

| Phase | Status | Commits |
|---|---|---|
| 1a. Tokenize close + structural tags | ✅ Shipped | `ac1461fd84` |
| 1b. Discovery defang (open-stack skip) | ✅ Shipped | `8a7326bae0` (superseded by `611fe9297c`) |
| 1c. Exclude `{{.}}` | ✅ Shipped | `ac1461fd84` |
| 1d. Suppress typeahead inside `{{/...}}` | ✅ Shipped | `ac1461fd84` |
| 2a. Mustache AST parser | ✅ Shipped | `611fe9297c` |
| 2b. Scope-aware variable discovery | ✅ Shipped | `611fe9297c` |
| 2c. Array-of-objects schema inference | ✅ Shipped | `97127e8da8` |
| 2d. Form-array editor (`+ Add row`) | ✅ Shipped | `749dfe21e2` |
| Nested section-opener inference | ✅ Shipped | `a75873cd50` |
| 2e. Editor validation decorations | ⏸ Deferred | — |

The parser already emits structured `ParseError[]` with character spans
(2a), so 2e is mostly a Lexical-plumbing follow-up — the data is there;
only the decoration adapter is missing.

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

### 2e' — Nested section-opener inference ✅ shipped (`a75873cd50`)

Initially deferred (this section originally described the gap and
sketched two fix options). Landed on the same branch after Arda's
request to close it before #4465 ships.

Approach: **Option 2 from the original sketch** — pass nested section
paths as dotted entries through the existing `sectionOpeners` hint
(rewritten via the parser to emit dotted paths), and have the schema
producer recurse to emit `{type: "array", items: …}` at each nested
section depth. Implementation summary:

1. `extractMustacheSectionOpeners` rewritten on the parser AST — walks
   sections with a path stack, emits dotted paths
   (`{"repos", "repos.contributors"}` for `{{#repos}}{{#contributors}}
   …{{/contributors}}{{/repos}}`).
2. `groupTemplateVariables` records nested-section paths per group via
   a new `nestedSectionsByGroup: Map<groupId, Set<subPath>>`. Each
   `GroupedTemplateVariable` gains an optional
   `sectionSubPaths: string[]` field.
3. `buildSubPathSchema` made recursive — accepts `sectionSubPaths` and
   the current prefix, emits `{type: "array", items: <recurse>}` for
   sub-paths that match the set, and stops emitting `_pathHints` when
   any property is an array (the hint format can't represent array
   nesting).
4. `buildEmptyShapeFromSchema` prefers `properties` over `_pathHints`
   when any nested property is `type: "array"` (otherwise the hint
   walk would silently strip the array shape).

For Mahmoud's QA prompt, `repos.contributors` now produces:

```
items: {
  type: 'object',
  properties: {
    name: { type: 'string' },
    contributors: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' } } }
    }
  }
}
```

And the empty-row template becomes `{name: '', contributors: []}` —
the form view renders an array editor with its own `+ Add row` inside
each `repos` row, matching the user's nested-iteration intent.

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

## Implementation history (PR #4465)

Phase 1 — landed:
1. Extended mustache regex in `TokenPlugin.tsx` (1a + 1c) — `ac1461fd84`.
2. Discovery walker open-stack skip (1b) — `8a7326bae0`.
3. Suppress typeahead inside `{{/...}}` (1d) — `ac1461fd84`.

Phase 2 — landed in the same PR (deviation from the original "follow-up
PR off main" plan, after the scope of #4465 stayed open longer than
expected and Mahmoud's QA escalated the section issue):
4. Hand-rolled Mustache parser (2a) at `web/packages/agenta-shared/src/utils/mustache/parser.ts` — `611fe9297c`.
5. Scope-aware discovery (2b) — `611fe9297c` (supersedes the depth-counter version from step 2).
6. Array-of-objects schema inference (2c) — `97127e8da8`.
7. Form-array editor with `+ Add row` (2d) — `749dfe21e2`.

Nested section-opener inference — landed in the same PR after the
initial deferral (`a75873cd50`):
8. Dotted-path section openers from the parser walker (utils.ts).
9. `groupTemplateVariables` records `sectionSubPaths` per group
   (portHelpers.ts).
10. Recursive `buildSubPathSchema` with array-at-depth emission
    (molecule.ts).
11. `buildEmptyShapeFromSchema` prefers properties over hints when
    arrays are present (viewTypes.ts).

Deferred to a follow-up PR (off main):
12. Editor validation decorations (2e) — the parser's `ParseError[]`
    output is ready to consume; just needs a Lexical decoration adapter.

Out of scope, per §2f:
10. Lambdas, partials, dynamic partials, delimiter swap, triple-stash —
    parser recognises them as inert tags; discovery skips them; runtime
    handles them.

### QA validation

Mahmoud's QA prompt `{{#repos}}{{name}}{{stars}}{{description}}
{{#contributors}}{{name}}{{/contributors}}{{/repos}}` produces:

- 4 top-level variable cards: `name`, `geo`, `user`, `repos`.
- `repos` opens in Form view (array of objects) with `+ Add row`.
- Each row exposes `name`, `stars`, `description` as string fields
  and `contributors` as another array editor with its own `+ Add row`
  button — the nested section opener is correctly inferred as
  array-of-objects.
- `{{/...}}`, `{{!comment}}`, `{{>partial}}`, `{{=…=}}` all tokenize as
  structural tags in the editor and don't surface as variables.
- `{{.}}` stays as plain text.

This matches the acceptance criteria from the original §1e plus the
Phase 2c+2d additions.
