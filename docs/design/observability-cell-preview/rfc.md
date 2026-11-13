# RFC: span-aware preview in the observability table cells

## Status

Implemented. See PR #4410. Three rules shipped: `input-key`, `output-key`,
`generations-output`. The `side` hint was kept on the chat rule for mixed
payloads (see decision below).

## Summary

The Inputs and Outputs cells in the observability table render the value as
either a chat preview or raw JSON. Anything that is not chat-shaped falls into
the same raw JSON bucket: tool calls, retriever outputs, HTTP responses, custom
workflow state. The user has to open the drawer to see anything useful.

This RFC adds a second heuristic layer between chat detection and the raw JSON
fallback. For span values whose shape we recognize, an extractor pulls a small
subset of fields and the cell renders only that subset using the existing
pretty key/value view. Everything else still falls through to raw JSON.

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
  | { renderer: "chat";   data: unknown[];               source: string }
  | { renderer: "pretty"; data: Record<string, unknown>; source: string }
  | { renderer: "json";   data: unknown;                 source: string }

export function extractPreview(
  value: unknown,
  side?: "input" | "output",
): Preview
```

The cell becomes a single switch.

```ts
function SmartCellContent({value}: {value: unknown}) {
  const preview = extractPreview(value)
  switch (preview.renderer) {
    case "chat":   return <ChatCell value={preview.data} />
    case "pretty": return <PrettyJsonCell value={preview.data} />
    case "json":   return <JsonCell value={preview.data} />
  }
}
```

`extractPreview` always returns something. The raw JSON path is the default
rule at the end of the registry, not a special case in the dispatcher.

### Internal rules

The dispatcher walks an ordered list of rules. The first rule that matches
wins. Each rule has a name and an `extract` function that returns the value
to pass to the renderer (or `null` if it does not match).

```ts
type Rule =
  | {
      kind: "chat"
      name: string
      extract: (v: unknown, ctx: { side?: "input" | "output" }) => unknown[] | null
    }
  | {
      kind: "pretty"
      name: string
      extract: (v: unknown, ctx: { side?: "input" | "output" }) => Record<string, unknown> | null
    }

const RULES: Rule[] = [
  chatRule,                // wraps the existing extractChatMessages
  inputKeyRule,            // matches {input: ...}
  outputKeyRule,           // matches {returnValues: {output: ...}}
  generationsOutputRule,   // matches LangChain {generations: [[{text}]]}
  // ...
]
```

The dispatcher tries rules in order. If one matches and extracts a non-null
value, it returns the matching `renderer` with the extracted data. If none
match, it returns `{renderer: "json", data: value, source: "fallback"}`.

Rules are shape-based. They look only at the value. No span context, no path.
The chat rule reads the optional `side` hint to disambiguate mixed payloads
(see decision below).

### Keep the `side` hint

The original draft proposed dropping `prefer`/`side` because the column
already slices to one side. Review caught a regression: some spans carry both
input-side and output-side chat keys in a single blob. The original chat
extractor was designed for this case (see
`docs/design/view-improvements/chat-extraction-algorithm.md`, edge case 2).
Without the hint, the Output cell can surface input chat.

Decision: keep `side` as an optional hint on `extractPreview`. The chat rule
passes it through as `prefer` to `extractChatMessages`. Other rules ignore
it. Callers that previously passed `chatPreference="input"` /
`chatPreference="output"` continue to work.

### Rules that shipped

Three concrete extractors are in the initial set:

- `input-key`: matches `{input: <defined>}`, surfaces `{input: <value.input>}`.
  Common in agenta input payloads under `ag.data.inputs`.
- `output-key`: matches `{returnValues: {output: <defined>}}`, surfaces
  `{output: <value.returnValues.output>}`. Common in agent output payloads
  under `ag.data.outputs`.
- `generations-output`: matches LangChain-style `LLMResult` shapes
  `{generations: [[{text: "..."}, ...], ...]}`. Flattens the 2D array, filters
  empty strings, surfaces `{output: text}` for a single text or
  `{outputs: [...]}` for many.

More rules ship as we identify common shapes in production traces.

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
External callers that import it directly keep working unchanged.

`JsonCellContent.pretty` already exists. The dispatcher uses it as the
"pretty" renderer. The `SmartCellContent.prettyJson` prop remains as a
caller opt-in for the JSON fallback path (used by `ScenarioListView` to force
pretty rendering on the raw-JSON branch).

`LastInputMessageCell` uses the dispatcher and renders only the last message
when the chat rule matches. For non-chat values it delegates to
`SmartCellContent`.

## Out of scope

- User-configurable rules. The registry is a static array for now. Making it
  hookable comes later.
- Rules that need span type or other span context. Shape-only for the first
  pass.
- Aligning the cell's pretty styling with the drawer's
  `PrettyJsonView`. The cell version is the lightweight one we already
  have. Visual parity with the drawer is a separate piece of work.
- Sharing rules with the drawer. The drawer has its own structure today. If
  the rule set proves valuable, we lift it out and reuse it.

## Follow-ups

- A test file mirroring
  `web/oss/tests/manual/cell-renderers/test-extract-chat-messages.ts` for the
  new rules, covering rule order and the JSON-string parse path.
- Reuse of `isPlainObject` from `@agenta/shared/utils` instead of the local
  copy in `extractPreview.ts`.
- Decide whether `LastInputMessageCell` should be folded into the dispatcher
  with a "last message only" chat-renderer variant.
