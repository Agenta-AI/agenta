# Trace/Panel View Modes

Authoritative definitions for the view-mode selector used in the trace drill-in
viewer ([TraceSpanDrillInView](./TraceSpanDrillInView.tsx)) and the legacy trace
drawer ([AccordionTreePanel](../SharedDrawers/TraceDrawer/components/AccordionTreePanel.tsx)).

If you are about to add, rename, or change the behavior of a view mode, update
this file first and keep the two panels aligned.

## Display targets

There are three display targets shared across modes:

1. **JSON code editor** — read-only, syntax-highlighted, grey background.
   Used by `json`, `yaml`, and `decoded-json`.
2. **Editor for prose** — the shared text/markdown editor.
   Used by `text` and `markdown`.
3. **Beautified component tree** — custom React layout.
   Used by `beautified-json` only.

## Modes

### `json` — Faithful

What the instrumentation stored, verbatim. No decoding, no reshaping.

- `isStringValue` that parses as JSON → the raw string verbatim (escaped `\n`,
  embedded quotes in stringified fields, ` ```json … ``` ` wrappers, all kept).
- `isStringValue` that does not parse → `JSON.stringify(value)` (wrapped in
  quotes so it is valid JSON in the code view).
- object / array → `getStringOrJson(value)` — a plain `JSON.stringify(_, null, 2)`.

Use `json` when you need to see exactly what is on the wire.

### `yaml` — Faithful, YAML

Same source data as `json`, emitted via `js-yaml` at 120-char line width.
No decoding is applied — if a string field contains stringified JSON, it comes
out as a YAML string containing stringified JSON. Intended for readability only.

### `decoded-json` — Decoded

Same JSON code editor as `json`, but the source is passed through the pipeline in
[decodedJsonHelpers.ts](./decodedJsonHelpers.ts) before pretty-printing:

1. If the raw value is a string, use its structure-parsed form —
   tolerates whitespace, fenced ` ```json … ``` ` blocks, one level of
   string-wrapping, and JSON5 syntax (single quotes, trailing commas).
2. `unwrapStringifiedJson` walks the structure and, for every string leaf that
   parses as JSON, replaces the string with the parsed value. So
   `{"result": "{\"ok\":true}"}` becomes `{"result": {"ok": true}}`.
3. `formatJsonStringsForDisplay` decodes escaped `\n` / `\r\n` in every
   remaining string leaf into real newlines (swapped to U+2028 so
   `JSON.stringify` keeps the multiline look without breaking the output).
4. Pretty-print with `JSON.stringify(_, null, 2)`.

Mental model: this is the inverse of serialization. If the wire data is a
JSON value wrapped in one or more layers of string-encoding and escape
sequences, this mode peels those layers away so you see the actual structure.

Use `decoded-json` when you want the real shape of LLM and tracing output
without wading through escape artifacts. This is what users mean when they
say "show the output as JSON" in the bug reports.

Historical note: this mode was previously labeled "Rendered JSON". The name
invited the misreading that it meant "rendered into another UI" — leading a
previous change to silently turn it into a chat-bubble view. The enum value
is now `decoded-json`. Do not reintroduce the old name.

### `beautified-json` — Reshaped

**This is the default for structured JSON data.** Not JSON at all — renders via
[BeautifiedJsonView](./BeautifiedJsonView.tsx), which uses a custom React
layout:

- Chat-like arrays and single messages → chat bubbles (role label + content
  editor with markdown support).
- Plain objects → labeled variable fields, recursively, with short leaves
  inlined as `key: value`.
- Known envelope patterns (AI SDK `{type: "text", …}`, `{type: "tool-call", …}`,
  `{type: "tool-result", …}`) are unwrapped.
- Noisy provider-metadata keys (`providerOptions`, `rawHeaders`, `rawCall`,
  `rawResponse`, `logprobs`, etc.) are stripped.

Use `beautified-json` when you want a readable presentation of chat messages
or when the structural rewriting is desirable. **Never** use it when the shape
needs to match the wire data — it hides fields.

### `text` — String

Rendered in the shared editor in plain-text mode. For a string value that
parses as JSON, escaped line breaks are normalized into real newlines; for
anything else the value is coerced via `getStringOrJson`. Useful for reading
an LLM response whose content is just prose.

### `markdown` — Markdown

Same as `text` but the editor is put into markdown-preview mode. Use when the
string is markdown-formatted (headings, lists, code fences).

## Default behavior

Both panels use the same default-selection logic:

- If `beautified-json` is available, default to `beautified-json`.
- Otherwise, if `decoded-json` is available, default to `decoded-json`.
- Otherwise the first available mode wins (in practice `text` for plain
  strings that do not parse as JSON).

## Availability matrix

| Source                                              | Available modes                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| object or array                                     | `json`, `yaml`, `decoded-json`, `beautified-json`                         |
| string that parses as structured JSON               | `json`, `yaml`, `decoded-json`, `beautified-json`, `text`, `markdown`     |
| string that does not parse as JSON                  | `text`, `markdown`                                                        |
| `viewModePreset="message"` + structured value       | `text`, `markdown`, `decoded-json`, `beautified-json`                     |
| `viewModePreset="message"` + unstructured string    | `text`, `markdown`                                                        |

## Change-safety rules

- **Do not reshape data inside `decoded-json`** beyond the string decoding
  described above. Any rewriting that changes the set of keys belongs in
  `beautified-json`.
- **Do not duplicate the decoding helpers.** Both panels import from
  [decodedJsonHelpers.ts](./decodedJsonHelpers.ts) and
  [BeautifiedJsonView.tsx](./BeautifiedJsonView.tsx) — a prior duplication
  is what caused the original "Rendered JSON" regression. If you need a new
  helper, add it to the shared module.
- If you change the `PanelViewMode` or `RawSpanDisplayMode` union, update the
  other and update this README.
