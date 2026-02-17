# Chat Extraction Algorithm

## Why this exists

The UI needs to decide how to render a value in table cells. It can show chat messages, JSON, or text.

This algorithm answers one question.

Does this payload contain chat messages that should render as a conversation?

We use this in shared cell renderers. A mistake here can affect observability, eval, and testset tables.

## Inputs and outputs

Input:
- `value: unknown`
- `options?: { prefer?: "input" | "output" }`

Output:
- `unknown[] | null`
- Returns a chat messages array if found and validated.
- Returns `null` when no chat payload is found.

## Core rules

1. Every candidate array must pass chat shape validation.
2. Preference is a hint. It changes search order only.
3. We stop after bounded recursion depth.
4. We keep backward compatibility for existing callers that do not pass options.

## Key sets

Input keys:
- `prompt`
- `input_messages`

Output keys:
- `completion`
- `output_messages`
- `responses`

Neutral keys:
- `messages`
- `message_history`
- `history`
- `chat`
- `conversation`
- `logs`

Wrapper candidates:
- `inputs`
- `outputs`
- `data`
- `data.inputs`
- `data.outputs`
- `request`
- `response`

## Step by step behavior

1) Empty guard

If the value is nullish, return `null`.

2) Direct array

If the value is an array, return it only when `isChatMessagesArray(value)` is true.

This blocks false positives like:

```json
{"prompt": [1, 2, 3]}
```

3) Object key scan with preference

If the value is an object, we scan key groups in this order:

- `prefer: "input"` -> input, then neutral, then output
- `prefer: "output"` -> output, then neutral, then input
- no preference -> neutral, then input, then output

For each key:
- if value at key is an array and passes chat validation, return it
- otherwise keep scanning

4) Recursive wrapper scan with preference

If key scan fails, recurse into wrapper candidates.

Search order follows preference:

- `prefer: "input"` starts with `inputs`, `data.inputs`, `request`
- `prefer: "output"` starts with `outputs`, `data.outputs`, `response`
- neutral starts with `data`, then `inputs`, then `outputs`

We recurse with bounded depth and a `WeakSet` to avoid cycles.

5) OpenAI choices fallback

If object has `choices`, extract `choice.message` or `choice.delta` values.
Return only if the resulting array passes chat validation.

6) Single message object

If the object itself looks like one chat message, return `[value]`.

7) No match

Return `null`.

## Where payloads come from

Common sources in this repo:

- OpenInference and OpenLLMmetry mapping in OTLP ingestion.
- Canonical Agenta chat keys under `inputs.prompt` and `outputs.completion`.
- Raw OpenAI style responses under `choices`.

Examples:

```json
{"prompt": [{"role": "user", "content": "hi"}]}
```

```json
{"completion": [{"role": "assistant", "content": "hello"}]}
```

```json
{"data": {"inputs": {"prompt": [{"role": "user", "content": "nested"}]}}}
```

```json
{"choices": [{"message": {"role": "assistant", "content": "from choices"}}]}
```

## How it shows in UI

If extractor returns chat messages:
- Cell uses chat renderer with truncation.
- Hover popover shows full chat.

If extractor returns null:
- Cell falls back to JSON or text renderer.

## Edge cases

1. Non-chat arrays under known keys
- Must not render as chat.

2. Mixed input and output payloads in one object
- Input column calls extractor with `prefer: "input"`.
- Output column calls extractor with `prefer: "output"`.

3. Only one side exists
- Preference does not block fallback. If preferred side is missing, other side can still match.

4. Deep nesting
- Search is bounded for safety. Very deep payloads may not match.

5. Cyclic objects
- Cycle guard prevents infinite recursion.

## Current caller policy

- Shared `SmartCellContent` stays neutral by default.
- Observability input preview passes `prefer: "input"`.
- Observability output cells pass `prefer: "output"`.

This keeps generic behavior stable while fixing column-specific correctness.
