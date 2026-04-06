# LLM Reasoning & Tool Call Observability in the Trace Drawer

**Branch:** `claude/trace-drawer-llm-reasoning-sFCkX`  
**Touches:** `sdk/agenta/sdk/litellm/litellm.py` · `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/OverviewTabItem/index.tsx`

---

## 1. Why This Matters

When an LLM uses reasoning/thinking (e.g. Claude with extended thinking) or calls Composio gateway tools, it may consume **thousands of tokens** deciding _how_ to construct a query — which action to call, what arguments to pass, how to combine multiple tool results. Without visibility into that process, you can't tell:

- Why the model picked a particular tool argument
- Whether the reasoning was correct or hallucinated
- How much of the token budget went to thinking vs. actual output
- Which tool calls were made in sequence and what each returned

The goal is to make all of this visible in the observability trace drawer without any changes to user app code.

---

## 2. Background: How Playground Execution Works

Understanding the execution path is important for knowing where to instrument things.

```
User clicks Run in Playground
        │
        ▼
Frontend web worker
  POST {variant_uri}/test           ← direct call to the user's app container
        │
        ▼
User's variant code (FastAPI app, decorated with @ag.instrument())
        │
        ├── calls litellm.completion() / litellm.acompletion()
        │           │
        │           ▼
        │   LitellmHandler (Agenta SDK callback)
        │   ┌─ log_pre_api_call  → captures inputs + model config → span
        │   └─ log_success_event → captures outputs             → span
        │
        ▼
Response returned to frontend (includes inline trace tree)
```

Key point: **Agenta never calls the LLM directly**. It instruments the user's litellm calls via a custom callback handler (`LitellmHandler`). The trace data lives in the span as `ag.data.inputs` / `ag.data.outputs`.

---

## 3. How Tool Calls Work (Composio Gateway)

When a variant has tools configured, the flow is:

1. Tools are stored in `LLMConfig.tools` as a list of function definitions
2. Tool slugs use the convention `tools__{provider}__{integration}__{action}__{connection}` (double-underscore separator, no dots — LLM provider requirement)
3. The LLM returns `tool_calls` in its response when it decides to call a tool
4. The playground UI shows a "Call tool" button — **tool execution is manual**, not automatic
5. Clicking it calls `POST /preview/tools/call` → Agenta backend → Composio → result returned
6. The result is added as a `role: "tool"` message and the playground re-runs

**No automatic execution loop.** Each tool call requires an explicit user action. The LLM deciding to call a tool and the tool actually running are two separate steps.

---

## 4. The Problems

### Problem A — SDK: Anthropic Thinking Blocks Dropped

**File:** `sdk/agenta/sdk/litellm/litellm.py`

The handler that captures LLM responses was:

```python
for choice in response_obj.choices:
    message = choice.message.__dict__   # ← the bug
    result.append(message)
```

In newer LiteLLM versions, when an Anthropic model responds with extended thinking enabled, LiteLLM **splits the response**:

| Attribute | Contains |
|---|---|
| `message.content` | Text only (plain string) |
| `message.thinking_blocks` | Reasoning blocks (separate attribute) |

`__dict__` captures `content` as a plain string. It sees `thinking_blocks` as just another attribute — but the handler never looked for it or included it in the output. **The reasoning was silently dropped.**

Result in the trace span:
```json
{
  "role": "assistant",
  "content": "Let me use the send_email action."   ← thinking gone
}
```

What it should be:
```json
{
  "role": "assistant",
  "content": [
    {"type": "thinking", "thinking": "I need to figure out which Gmail action to use. The user wants to send a message to..."},
    {"type": "text",    "text": "Let me use the send_email action."}
  ]
}
```

### Problem B — Frontend: Complex Content Not Rendered

**File:** `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/OverviewTabItem/index.tsx`

Even when thinking blocks survived to the span, the trace drawer rendered them as raw JSON. Three specific gaps:

1. `getMessageText()` in `TraceSpanDrillInView` only extracted `{type:"text"}` blocks — other types were silently dropped when computing the display string.

2. `normalizeChatMessages()` extracted `tool_calls` from message objects, but `RenderedChatMessages` never rendered them.

3. When a message's `content` was a mixed array of thinking + text + tool_use blocks, `OverviewTabItem` passed the whole array to a generic panel that JSON-stringified it.

### Problem C — OpenAI Reasoning Models (o1, o3, o4-mini): Not Fixable

For OpenAI's o-series reasoning models, reasoning tokens are **consumed internally** and **never returned in the API response**. This is an OpenAI API design decision. There is no client-side fix — the thinking is invisible by design at the provider level.

---

## 5. The Fixes

### Fix A — SDK: Preserve Thinking Blocks (`litellm.py`)

Replaced the direct `__dict__` access with a helper that reconstructs a unified content block array:

```python
def _extract_message_dict(message: Any) -> Dict[str, Any]:
    msg_dict = {k: v for k, v in message.__dict__.items() if not k.startswith("_")}

    thinking_blocks = getattr(message, "thinking_blocks", None)
    if not thinking_blocks:
        return msg_dict   # nothing to do for non-thinking responses

    full_content: List[Dict[str, Any]] = []

    # Extract thinking blocks (handles both dict and object formats)
    for block in thinking_blocks:
        if isinstance(block, dict) and block.get("thinking") is not None:
            full_content.append({"type": "thinking", "thinking": str(block["thinking"])})
        elif hasattr(block, "thinking") and block.thinking is not None:
            full_content.append({"type": "thinking", "thinking": str(block.thinking)})

    # Append the text content after
    text_content = msg_dict.get("content")
    if isinstance(text_content, str) and text_content:
        full_content.append({"type": "text", "text": text_content})
    elif isinstance(text_content, list):
        full_content.extend(text_content)

    if full_content:
        msg_dict["content"] = full_content

    return msg_dict
```

Both `log_success_event` and `async_log_success_event` now call `_extract_message_dict(choice.message)` instead of `choice.message.__dict__`.

**This fix is backwards-compatible.** For models without thinking, `thinking_blocks` is absent and the function returns the plain dict unchanged.

### Fix B — Frontend: Structured Rendering of Reasoning + Tool Calls (`OverviewTabItem/index.tsx`)

Added detection and structured rendering for messages that contain reasoning or tool calls.

**Detection** (`hasComplexMessageContent`):
```typescript
// Anthropic: content array with thinking/tool_use blocks
if (Array.isArray(message.content)) {
    const hasThinking = message.content.some(b => b?.type === "thinking")
    const hasToolUse  = message.content.some(b => b?.type === "tool_use")
    if (hasThinking || hasToolUse) return true
}
// OpenAI: tool_calls property on the message
if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true
```

**Reasoning display** (`ReasoningSection`):
- Collapsible, collapsed by default
- Amber/yellow styling to visually distinguish from output
- Shows a text preview in the collapsed state so you can see if it's relevant without expanding

**Tool call display** (`ToolCallRow`):
- One row per tool call
- Blue-tinted, shows function name (gateway slugs reformatted: `tools__x__gmail__send__conn` → `gmail / send / conn`) and call ID in header
- Arguments as formatted JSON below, scrollable up to 240px

**Supported formats:**

| Format | Source |
|---|---|
| `content: [{type:"thinking",...}, {type:"tool_use",...}]` | Anthropic API |
| `content: "text", tool_calls: [{function:{name,arguments}}]` | OpenAI API |
| Mixed: thinking blocks + text + tool_use in same content array | Anthropic extended thinking with tools |

Messages without complex content continue through the existing rendering path unchanged.

---

## 6. What You See After the Fix

For a Claude call with extended thinking + a Composio tool invocation, the trace drawer overview tab now shows:

```
┌─────────────────────────────────────────────┐
│ assistant                                   │
├─────────────────────────────────────────────┤
│  ▶ Reasoning   I need to find the right ... │  ← collapsible amber block
│                                             │
│  Let me use the send_email action.          │  ← text content
│                                             │
│  ┌─ gmail / send_email / my-connection ─────┐ │  ← tool call row (blue)
│  │ call_abc123                              │ │
│  ├──────────────────────────────────────────┤ │
│  │ {                                        │ │
│  │   "to": "alice@example.com",             │ │
│  │   "subject": "Meeting tomorrow",         │ │
│  │   "body": "..."                          │ │
│  │ }                                        │ │
│  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Expanding the Reasoning section reveals the full thinking text — potentially thousands of tokens of model reasoning about how to construct the query.

---

## 7. Activating Extended Thinking

Thinking blocks only appear in the trace when the model was actually asked to think. For Anthropic Claude:

1. Open the variant in the playground
2. In the model configuration, set **Reasoning Effort** to `low`, `medium`, or `high`
   - This maps to `LLMConfig.reasoning_effort` in `sdk/agenta/sdk/types.py`
   - LiteLLM translates this to Anthropic's `thinking: {type: "enabled", budget_tokens: N}` parameter
3. Use a model that supports extended thinking (e.g. `claude-3-7-sonnet-20250219`)

For OpenAI reasoning models (`o1`, `o3`, `o4-mini`): reasoning is hidden at the API level. The `reasoning_effort` parameter controls _how much_ reasoning the model does, but the content is never returned. Nothing to show.

---

## 8. Token Cost Awareness

Thinking tokens are billed as **output tokens** by Anthropic. The existing token metrics in the trace drawer (`prompt_tokens`, `completion_tokens`, `total_tokens`) already include thinking tokens in `completion_tokens`. There is no separate breakdown.

If a span shows unexpectedly high completion token counts on a Claude model, extended thinking is the most likely cause.

---

## 9. File Reference

| File | What changed |
|---|---|
| `sdk/agenta/sdk/litellm/litellm.py` | Added `_extract_message_dict()`, updated both success event handlers |
| `web/oss/src/.../OverviewTabItem/index.tsx` | Added `ComplexMessagePanel`, `ReasoningSection`, `ToolCallRow`, detection helpers |

**No changes required in user app code.**

---

## 10. Known Limitations

| Limitation | Reason |
|---|---|
| OpenAI o-series reasoning invisible | API design — tokens consumed but not returned |
| Thinking only shown when `reasoning_effort` is set | Anthropic does not return thinking blocks unless explicitly requested |
| Tool execution has no child span | Composio calls go through `POST /preview/tools/call`, not through the LLM instrumentation path — no OTel span is created |
| Streaming responses not captured | `log_stream_event` / `async_log_stream_event` in `LitellmHandler` are no-ops; only non-streaming responses are traced |
