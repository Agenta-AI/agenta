# Gap 06 — Messages renderer + tool-call card

**Scope:** Frontend only.

**Anchor fixture:** `07-messages-and-tools.json`

**Audited 2026-05-04 against production.** Most of "messages renderer coverage" already ships. The unique gap-06 contribution is the **tool-call card** — a dedicated UI for assistant `tool_calls` that today render as inline text strings.

## What production already does

| Capability | Where |
| --- | --- |
| `ChatMessageList` renders any field where `dataType === "messages"` — regardless of editability or depth | `DrillInContent.tsx:1284-1298` (comment in code says exactly that) |
| `ToolMessageHeader` for `role: "tool"` responses | `web/packages/agenta-ui/src/ChatMessage/` |
| Assistant `tool_calls` formatted as inline text via `extractDisplayTextFromMessage` (e.g. `get_weather({"city":"NYC"})`) | same renderer |
| Table cell preview for messages columns | `ChatMessagesCellContent` (already in production) |

The pattern: **any messages-shaped field renders with chat cards, just at the depth the user has drilled to.** Auto-expand at root (gap-03) brings that to first render without a click.

What's NOT in production:

- A dedicated **tool-call card** UI (today tool_calls render as inline text strings).
- The `[tool]` chip in table cells (subset of gap-01 chip vocabulary applied to tool-call columns).
- Auto-rendering at root (subset of gap-03 — fixed when auto-expand lands).

## What gap-06 actually proposes (after accounting for what already ships)

1. **Dedicated tool-call card.** Render assistant `tool_calls` as a card below the message body: function name as a heading, arguments JSON pretty-printed (parsed from the string). The genuinely new rendering. Production formats them as inline text because the original chat-message contract inherited from OpenAI uses string-encoded `arguments`.

   ```text
   ┌───────────────────────────────────────────────┐
   │ assistant                                     │
   │ I'll look up the country for you.             │
   │                                               │
   │ ┌───────────────────────────────────────┐     │
   │ │ tool call: lookup_country             │     │
   │ │ {                                     │     │
   │ │   "country": "Kiribati"               │     │
   │ │ }                                     │     │
   │ └───────────────────────────────────────┘     │
   └───────────────────────────────────────────────┘
   ```

2. **`[tool]` chip in table cells** — part of gap-01 chip vocabulary applied to tool-call columns. Lets the user see tool-call columns at a glance.

3. **Root-level rendering** — falls out of gap-03 (auto-expand). When auto-expand lands, the user sees `inputs.messages` rendered with chat cards at root without the drill-in click. *Not a unique gap-06 contribution; the lift comes from gap-03.*

## Subset relationship

The unique gap-06 piece is the tool-call card. Everything else is either already in production (`ChatMessageList` + `ChatMessagesCellContent`) or comes from another gap (gap-03 auto-expand, gap-01 chip). We're calling it out as its own gap because the tool-call card has its own design surface that doesn't fit cleanly under gap-01 or gap-03.

## Detection

`detectDataType` in `fieldUtils.ts:185` already classifies messages-shaped arrays via `isChatMessageObject`:

```typescript
const hasRole = typeof obj.role === "string" || typeof obj.sender === "string"
const hasContent = obj.content !== undefined || obj.text !== undefined || ...
return hasRole && hasContent
```

Tool-call detection (for the `[tool]` chip + card) is a similar shape match: array where every element is `{id, type: "function", function: {name, arguments}}`. Both detections happen at render time — no schema dependency.

## Surface-by-surface wiring

| Surface | Today | After fix |
| --- | --- | --- |
| Testset table cell — `messages` column | `ChatMessagesCellContent` (chat preview) ✓ | unchanged |
| Testset table cell — `tool_calls` column | Raw JSON / single-line summary | `[tool]` chip + count + first call name preview |
| Drill-in Fields view (root) — `messages` array | Rendered via `ChatMessageList` *if drilled to that depth*. At root: collapsed `[json-array] [Drill In]` | Auto-expand (gap-03) renders chat cards inline at root |
| Drill-in Fields view — assistant message with `tool_calls` | Inline text via `extractDisplayTextFromMessage` (functional but not visually distinct) | **Dedicated tool-call card** (gap-06's unique contribution) |
| Drill-in Fields view — `tool_calls` array | Raw JSON code editor | Stack of tool-call cards |
| Drill-in JSON view | Raw JSON ✓ | unchanged |

## Recommendation

Ship the tool-call card + `[tool]` chip. Auto-expand at root falls out of gap-03 (no separate work for gap-06).

## Competitive validation (added 2026-05-04)

This is one of three places **both competitors are behind us if we ship**. See [`../competitive-analysis.md`](../competitive-analysis.md) §6.

- **Braintrust** — renders messages-shaped arrays as **YAML in the cell and YAML in the drill-in**. No chat cards. No role colouring. No tool-call cards. The `arguments` field on a tool call stays as a literal stringified-JSON string with surrounding quotes intact. Functional but not specialized.
- **Langfuse** — renders messages as JSON in the modal, same as everything else. No chat cards. No tool-call cards.
- **Adjacent finding (Langfuse playground)** — Langfuse exposes a `+ Placeholder` primitive in the playground (a runtime-injected message slot, distinct from `+ Message`). Worth borrowing for agent prompts that take a chat history at run time, but not directly part of this gap.

**Net:** lifting `ChatMessageList` everywhere it should fire (already done in production at any drill depth — gap-03 auto-expand brings it to root), plus the tool-call card, **puts us past both competitors on this dimension.** Don't deprioritize — this is one of three places (along with gap-02 stringified-JSON parse-on-detect and gap-04 projection toggle) where we go further than the field, not catch up.

## Cross-references

- `gap-01` — `[msgs]` + `[tool]` chips, both in vocabulary
- `gap-02` — messages preview in table cells (already in production via `ChatMessagesCellContent`)
- `gap-03` — auto-expand surfaces messages at root (root rendering is gap-03's job, not gap-06's)
