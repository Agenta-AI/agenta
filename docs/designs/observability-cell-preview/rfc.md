# RFC: span-aware preview in the observability table cells

## Status

Draft. No code yet.

## Summary

The Inputs and Outputs cells in the observability table render the value as
either a chat preview or raw JSON. Anything that is not chat-shaped falls into
the same raw JSON bucket: tool calls, retriever outputs, HTTP responses, custom
workflow state. The user has to open the drawer to see anything useful.

This RFC adds a second heuristic layer between chat detection and the raw JSON
fallback. For span values whose shape we recognize, an extractor pulls a small
subset of fields and the cell renders only that subset using the existing
beautified key/value view. Everything else still falls through to raw JSON.

The two existing detector calls (one for chat, one implicit for JSON) become
internal rules of a single dispatcher. The cell stops chaining nullable checks
and switches on a discriminated union instead.

## Today

The Inputs cell reads `attributes.ag.data.inputs` from the span. The Outputs
cell reads `attributes.ag.data.outputs`. Each cell hands its value to
`SmartCellContent` (or `LastInputMessageCell` for inputs), which runs
`extractChatMessages` and either renders a chat preview or falls through to
`JsonCellContent` for raw JSON.

The chat detector is shape-based. It takes a value and returns a chat array or
`null`. A `prefer: "input" | "output"` hint reorders which keys it tries
first, but since the column has already sliced the data to one side, the hint
almost never changes the result.

## Proposal

### One dispatcher

Replace the two-step "try chat, else JSON" with a single function that returns
both the data to render and the renderer to use.

```ts
type Preview =
  | { renderer: "chat";       data: unknown[];                  source: string }
  | { renderer: "beautified"; data: Record<string, unknown>;    source: string }
  | { renderer: "json";       data: unknown;                    source: "fallback" }

export function extractPreview(value: unknown): Preview
```

The cell becomes a single switch.

```ts
function SmartCellContent({value}: {value: unknown}) {
  const preview = extractPreview(value)
  switch (preview.renderer) {
    case "chat":       return <ChatCell value={preview.data} />
    case "beautified": return <BeautifiedJsonCell value={preview.data} />
    case "json":       return <JsonCell value={preview.data} />
  }
}
```

`extractPreview` always returns something. The raw JSON path is the default
rule at the end of the registry, not a special case in the dispatcher.

### Internal rules

The dispatcher walks an ordered list of rules. The first rule that matches
wins. Each rule has a name, a `matches` predicate, and an `extract` function
that returns the value to pass to the renderer.

```ts
type Rule =
  | {
      kind: "chat"
      name: string
      matches: (v: unknown) => boolean
      extract: (v: unknown) => unknown[] | null
    }
  | {
      kind: "beautified"
      name: string
      matches: (v: unknown) => boolean
      extract: (v: unknown) => Record<string, unknown> | null
    }

const RULES: Rule[] = [
  chatRule,             // wraps the existing extractChatMessages
  toolCallInputRule,    // matches {tool_name, arguments}
  retrieverOutputRule,  // matches {documents: [...]}
  httpResponseRule,     // matches {status_code, body}
  // ...
]
```

The dispatcher tries rules in order. If one matches and extracts a non-null
value, it returns the matching `renderer` with the extracted data. If none
match, it returns `{renderer: "json", data: value, source: "fallback"}`.

Rules are shape-based. They look only at the value. No span context, no path,
no side hint.

### Drop the side hint

`prefer` / `side` is dead weight today. The column already slices
`ag.data.inputs` or `ag.data.outputs` before calling the dispatcher, so the
hint has nothing to disambiguate. Drop it from the new signature.

If a future rule legitimately needs both sides (a diff renderer), we widen
the signature for that rule then. Not now.

### First rules to ship

Three concrete extractors cover the common non-chat cases. Exact field shapes
will be confirmed against real traces during implementation.

- `tool-call-input`: matches values with `tool_name` and `arguments`. Renders
  the tool name and the arguments.
- `retriever-output`: matches values with a `documents` array. Renders the
  query and a document count.
- `http-response`: matches values with `status_code` and a body or response
  field. Renders the status, latency if present, and the body summary.

We ship more rules as we identify common shapes in production traces.

### Popover behavior

Match what the chat path already does. The popover on hover shows the same
content as the cell, just untruncated. The drawer remains the escape hatch for
the full raw payload.

If a heuristic misfires often enough to be confusing, we revisit this and
consider showing the summary on top of the raw payload in the popover. Not
now.

## Where the code lives

The dispatcher and rules live in `@agenta/ui/cell-renderers` next to
`extractChatMessages`. Rules are shape-based, so they belong in the shared
package. The OSS column code and the annotation-ui callsites pick up the new
behavior automatically because they go through `SmartCellContent`.

## Migration

`extractChatMessages` stays as an internal helper that the chat rule wraps.
External callers that import it (if any outside `SmartCellContent` and
`LastInputMessageCell`) keep working unchanged.

`JsonCellContent.beautified` and `SmartCellContent.beautifyJson` already
exist. The dispatcher uses them as the "beautified" renderer. No new
renderer components needed.

`LastInputMessageCell` is a special case: it shows only the last message and
expects chat data. It continues to use `extractChatMessages` directly, or it
gets retired in favor of a chat rule + cell variant. Decide during
implementation.

## Out of scope

- User-configurable rules. The registry is a static array for now. Making it
  hookable comes later.
- Rules that need span type or other span context. Shape-only for the first
  pass.
- Aligning the cell's beautified styling with the drawer's
  `BeautifiedJsonView`. The cell version is the lightweight one we already
  have. Visual parity with the drawer is a separate piece of work.
- Sharing rules with the drawer. The drawer has its own structure today. If
  the rule set proves valuable, we lift it out and reuse it.

## Open questions

1. Does the chat rule still need a `prefer` parameter for the rare
   both-sides-in-one-blob case? Default position: no, drop it. Add it back if
   we hit real data that needs it.
2. Should `LastInputMessageCell` be folded into the new dispatcher with a
   "last message only" variant of the chat renderer, or kept as a separate
   component the Inputs column calls? Lean toward folding it in for
   consistency.
3. What is the source of truth for the list of recognized shapes? Define it
   in `web/packages/agenta-ui/src/CellRenderers/rules/` as one file per rule.
