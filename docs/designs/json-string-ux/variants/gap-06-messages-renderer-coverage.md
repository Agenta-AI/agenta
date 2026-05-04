# Gap 06 — Messages renderer coverage is incomplete

**Scope:** Frontend only.

**Anchor fixture:** `07-messages-and-tools.json`

## What's broken

`messages` is a special type per the RFC (typed list of `{role, content, ...}` objects). The codebase has a dedicated `ChatMessageEditor` component that renders messages beautifully (system/user/assistant/tool cards, content, tool_calls). But the renderer doesn't kick in everywhere it should.

From the screenshots:

| Surface | What renders | Should render |
| --- | --- | --- |
| Testset table — `messages` column | ChatMessageEditor (system/user cards) ✓ | Already correct |
| Testset table — `tool_calls` column | Raw JSON `[]` or single-line summary | ChatMessageEditor or dedicated tool-call view |
| Drill-in Fields view (root) — when `messages` is a top-level value | Raw JSON code editor (e.g. `[{"role":"system",...},...]`) | ChatMessageEditor |
| Drill-in Fields view (after drill) — `messages [3 items]` | ChatMessageEditor with drill-in cards ✓ | Already correct |
| Drill-in Fields view (after drill) — `tool_calls` | Raw JSON code editor | Dedicated tool-call view |
| Drill-in JSON view | Raw JSON ✓ | Always faithful, leave as-is |

The pattern: **ChatMessageEditor is wired for `messages` only after Drill In** — at the root, large arrays of message-shaped objects fall through to the generic JSON editor. **`tool_calls` is never given the dedicated treatment** even though it's structurally similar.

## What "messages-shaped" means

`detectDataType` in `fieldUtils.ts:185` already classifies messages-shaped arrays via `isChatMessageObject`:

```typescript
const hasRole = typeof obj.role === "string" || typeof obj.sender === "string"
const hasContent = obj.content !== undefined || obj.text !== undefined || ...
return hasRole && hasContent
```

So detection works. The gap is wiring the detection result to the renderer at all the surfaces above.

## Tool calls — the second-class case

`tool_calls` arrays in fixture 07 look like:

```json
[
  {
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "lookup_country",
      "arguments": "{\"country\":\"Kiribati\"}"
    }
  }
]
```

These aren't messages but they're structured records the user wants to inspect. Today they render as raw JSON code editors. Two options:

- **Reuse ChatMessageEditor** with a "tool" variant that shows function name + args nicely
- **Build a dedicated `ToolCallView`** (already exists in `agenta-playground-ui/src/components/ToolCallView/`)

Both of those components exist. The change is wiring detection → renderer.

## Three approaches

### Variant A — Wire all detected messages/tool_calls to dedicated renderers (recommended)

For every surface (table cell, drill-in root view, drill-in drilled-in view):

- If `detectDataType(value) === "messages"` → render with `ChatMessageEditor`
- If the value is an array and every element matches a tool-call shape (`{id, type: "function", function: {name, arguments}}`) → render with `ToolCallView`
- Else fall through to existing chip + preview behavior from `gap-02`

The detection is already there. The change is calling it at the right places.

**Pros:** consistent renderer everywhere. Users always get the rich view for the types we have rich renderers for. Minimal new UI.
**Cons:** more code paths to maintain. Tool call detection is heuristic — false positives possible.

### Variant B — Extend `detectDataType` to include "tool_calls"

Add a new case to the existing detection:

```typescript
type DataType = "string" | "messages" | "tool_calls" | "json-object" | "json-array" | ...
```

Then surface-by-surface wire `tool_calls` to a dedicated view.

**Pros:** keeps detection central. New "tool_calls" type chip adds clarity.
**Cons:** adds a category the rest of the system has to learn. False positives on the heuristic still possible.

### Variant C — Don't ship tool_calls treatment, leave as raw JSON

Only wire `messages` everywhere. Leave `tool_calls` rendering as raw JSON; users drill in to see the function call structure.

**Pros:** smallest change. No false-positive risk.
**Cons:** the screenshot evidence shows `tool_calls` is structurally rich and the user has zero affordance to read them at a glance.

## Recommendation

**Variant A** for `messages`. **Variant C** for `tool_calls` in v1, defer to v2.

`messages` is unambiguously detectable, has a polished renderer, and the gap is purely "wire it everywhere." Ship that.

`tool_calls` detection is a heuristic. Get a few real-world tool-call traces in front of users, see if raw JSON is genuinely a problem, then decide. Don't lock in a renderer choice based on one fixture.

## Surface-by-surface wiring

| Surface | Today | After fix |
| --- | --- | --- |
| Testset table cell | ChatMessageEditor for `messages` ✓ | unchanged |
| Drill-in Fields view (root) | Raw JSON for `messages` array | ChatMessageEditor inline (auto-expanded per `gap-03`) |
| Drill-in Fields view (after drill) | ChatMessageEditor ✓ | unchanged |
| Drill-in JSON view | Raw JSON ✓ | unchanged |
| Variables panel | n/a | n/a (messages aren't typically inserted as `{{messages}}`; chat history is appended via different mechanism) |

## Competitive validation (added 2026-05-04)

This is the gap where **both competitors are behind us if we ship**. See [`../competitive-analysis.md`](../competitive-analysis.md) §6.

- **Braintrust** — renders messages-shaped arrays as **YAML in the cell and YAML in the drill-in**. No chat cards. No role colouring. No tool-call cards. The `arguments` field on a tool call stays as a literal stringified-JSON string with surrounding quotes intact. Functional but not specialized.
- **Langfuse** — renders messages as JSON in the modal, same as everything else. No chat cards. No tool-call cards.
- **Adjacent finding (Langfuse playground)** — Langfuse exposes a `+ Placeholder` primitive in the playground (a runtime-injected message slot, distinct from `+ Message`). Worth borrowing for agent prompts that take a chat history at run time, but not directly part of this gap.

**Net:** lifting `ChatMessageEditor` everywhere it should fire, plus the tool-call card, **puts us past both competitors on this dimension**. Don't deprioritize — this is one of three places (along with gap-02 stringified-JSON detection and gap-04 projection toggle) where we go further than the field, not catch up.

## Cross-references

- `gap-01` — `[msgs]` chip in chip vocabulary
- `gap-02` — non-messages object/array cell rendering
- `gap-03` — drill-in root view auto-expand (messages renderer kicks in via this path)
