# Frontend: agent chat UI — engine + rendering decision

Status: proposal / analysis (for team review)
Date: 2026-06-17
Scope: frontend surface for the new `agent` workflow type (relates to Mahmoud's
WP-4 multi-message output, WP-5 chat vs completion, WP-6 workflow type)
Author context: FE owner analysis, code-grounded (not from memory)

---

## TL;DR (the decision)

1. **Adopt an engine, don't build one.** Use the Vercel AI SDK `useChat` hook as the
   agent conversation engine (streaming + typed message parts + tool-call lifecycle +
   human-in-the-loop approval). Do **not** rebuild streaming/parts/approval inside our
   Jotai + web-worker playground pipeline.
2. **Use library components for the agent surface, inject our features into them.** Do
   **not** reuse our existing chat message components for agent output. Our message body
   is a controlled Lexical editor built for *editing* discrete messages; it is hostile to
   live streaming and has no tool-call/reasoning/approval rendering.
3. **It runs as a parallel path, not inside the existing chat pipeline.** Completion/chat
   stay on the web-worker + Jotai-message-store path. The agent surface shares config,
   shell, and the tool picker, but owns its own conversation state (no mirroring).
4. **The gate is the backend stream emitter, not the FE.** Pi already streams and the
   wrapper already consumes the deltas; it just buffers them. Forwarding is days, not a
   greenfield build.

---

## Context

Agenta is adding `agent` as a fourth workflow type (alongside completion, chat, judge).
Unlike the others it is multi-turn, tool-using, sandboxed, and emits **multi-message
output** (text + reasoning + tool calls + results) rather than a single completion.

The MVP currently makes an agent ride the chat playground by flagging it `is_chat`
(`web/packages/agenta-entities/src/workflow/state/appUtils.ts`). That gets it into the UI
but the chat UI cannot render an agent's streaming, multi-step trajectory.

Slack thread (2026-06-17, Mahmoud + Arda + JP) consensus: reuse a chat UI that already
solved streaming / tool calls / approvals rather than rebuild; accept losing edit /
comparison / eval for the agent surface initially (keep them for completion); adopt a
Responses-API-style array of typed *Items* for output (= ai-sdk `UIMessage` parts);
introduce the session concept early.

---

## Architecture: engine vs skin

The features split into two buckets with very different costs in our system:

| Bucket | Examples | Build in-house? |
|---|---|---|
| **Rendering** | multi-message, tool-call display, trajectory | cheap, but see Lexical risk below |
| **Runtime engine** | streaming, parts model, tool-call lifecycle, approval pause/resume | **expensive — adopt, don't rebuild** |

Rebuilding the runtime engine (a streaming transport into our atoms, a `SimpleChatMessage`
extension for reasoning/tool-lifecycle/streaming-status, an approval pause/resume
primitive) is re-deriving exactly what ai-sdk ships — and exactly the `UIMessage` parts
model JP wants as the contract. So: **adopt the engine; the only real choice left is how
to render its output.**

---

## Q2 — Risk of reusing our own components (verified in code)

The message body renders through a **controlled Lexical editor** that rebuilds its node
tree on every value change:

```
ChatTurnView → TurnMessageAdapter → ChatMessageEditor → SharedEditor → Editor (Lexical)
```

```ts
// web/packages/agenta-ui/src/Editor/Editor.tsx — runs on each inbound value change
editor.registerCommand(ON_HYDRATE_FROM_REMOTE_CONTENT, ({hydrateWithRemoteContent}) => {
  const root = $getRoot()
  root.clear().append(codeNode)   // full document rebuild, per update
})
```

Streaming ~30-50 token deltas/sec into that prop means a document rebuild per delta, plus
focus-deferral logic (hydration is deferred while focused to avoid caret jumps). The
editor has no `isStreaming`/`partial` handling.

| Risk | Detail |
|---|---|
| Lexical rebuilds per value change | `$getRoot().clear().append(...)` on every controlled value update |
| Editor is for *editable* messages | agent output is read-only streaming → wrong tool |
| "Reuse" is largely illusory | the one component we'd reuse is the one we can't use for streaming |
| No tool-call lifecycle / reasoning / approval | `ToolCallView` shows finished calls as static JSON; no pending/executing/approval states |
| `ChatTurnView` renders one `lastAssistantMessage` | multi-step trajectory = turn-renderer rework |

Conclusion: "our own components" still means building new read-only streaming +
tool-lifecycle components from scratch, on a foundation built for discrete, editable,
single messages. (The perf magnitude is inferred from the code, not benchmarked — worth a
1-hour spike to confirm, but the rebuild mechanism is real.)

---

## Q1 — Injecting our features into library components

Key finding: **our features are not locked inside our components.** They are a global
Jotai atom plus one reusable presentational component, so they drop into any host
(AI Elements is copy-in and fully editable; antd-x `Bubble` has footer slots).

| Feature | Existing hook to reuse | How to inject |
|---|---|---|
| View trace | `openTraceDrawerAtom` (global) | `getDefaultStore().set(openTraceDrawerAtom, {traceId})` |
| Trace button (prebuilt) | `<SharedGenerationResultUtils traceId={…} />` | drop into the component's footer slot |
| Copy / rerun / delete | `TurnMessageHeaderOptions` actions, or raw handlers | pass `onClick` to library action buttons |

`trace_id` already travels in `RunResult.traceId` / `MessageExecution.traceId`; for the
agent path it arrives via the stream's message metadata. The trace drawer is already
mounted in the playground shell, so opening it is one atom write.

### Working integration sketch (AI Elements + our atoms)

```tsx
import {getDefaultStore} from "jotai"
import {openTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {Message, MessageContent} from "@/components/ai-elements/message"
import {Response} from "@/components/ai-elements/response"
import {Tool, ToolHeader, ToolContent} from "@/components/ai-elements/tool"
import {Actions, Action} from "@/components/ai-elements/actions"

function AgentMessage({message}: {message: UIMessage}) {
  const traceId = (message.metadata as any)?.traceId
  const text = message.parts.filter(p => p.type === "text").map(p => p.text).join("")

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, i) => {
          if (part.type === "text")      return <Response key={i}>{part.text}</Response>
          if (part.type === "reasoning") return <Response key={i} className="opacity-70">{part.text}</Response>
          if (part.type.startsWith("tool-"))
            return (
              <Tool key={i}>
                <ToolHeader type={part.type} state={part.state} />
                <ToolContent input={part.input} output={part.output} />
              </Tool>
            )
          return null
        })}
      </MessageContent>

      {/* our features, injected — same atoms the playground already uses */}
      <Actions>
        {traceId && <SharedGenerationResultUtils traceId={traceId} />}
        <Action label="Copy"  onClick={() => navigator.clipboard.writeText(text)} />
        <Action label="Rerun" onClick={() => regenerate()} />
        <Action label="Trace" onClick={() => getDefaultStore().set(openTraceDrawerAtom, {traceId})} />
      </Actions>
    </Message>
  )
}
```

Tool-call lifecycle, reasoning, and streaming text come from the library for free; the
trace/copy/rerun row is three lines wired to existing global atoms.

---

## Side-by-side

| | Library components + inject | Our components, adapted |
|---|---|---|
| Streaming text | built-in, battle-tested | build new read-only renderer (Lexical can't) |
| Tool-call lifecycle / reasoning / approval | built-in (`Tool`/`Reasoning`/`Confirmation`) | build all from scratch |
| Trace / copy / rerun | 3-line injection via existing atoms | already present, but on the wrong (editable) component |
| Look on day 1 | shadcn default → theme to taste | matches app instantly |
| Tailwind cost | AI Elements targets v4 (port ~6 components to v3, or accept look) | none |
| Risk profile | library churn; theming work | fighting a single-message, editable, non-streaming design |
| Time to reliable MVP FE | days | 1.5+ weeks + bug tail |

---

## Library choice (rendering layer)

Two viable skins over the `useChat` engine:

- **AI Elements** (ai-sdk's own components): native to `useChat` parts, copy-in (fully
  editable), the post-antd destination. Caveat: targets React 19 (met) + **Tailwind v4**
  (we are on v3.4). Either port the ~6 components used to v3, or accept the look for v1.
- **Ant Design X**: matches antd instantly, no Tailwind change, MIT. Caveat: its
  components partly assume its own `useXChat` state ownership; thrown away when we leave
  antd later; small parts→props adapter needed.

Repo signal: `web/_reference/@agenta/sdk-ai` is described as a "Vercel AI SDK adapter" and
`@agenta/sdk-tracing` already ships an `aiSdkMapper` for "Vercel AI SDK v6" — the org's TS
SDK direction is AI-SDK-shaped, which favors the AI Elements / ai-sdk path.

### Tailwind v4 note (do NOT bundle into this push)

A v4 migration is standalone 2-4 day work, not an afternoon: `corePlugins.preflight:false`
(the antd coexistence seam) is removed in v4; the regex `safelist` must move to
`@source inline`; the config runs antd's JS tokens at build time
(`web/oss/tailwind.config.ts`), forcing the legacy `@config` shim so we capture little v4
upside. Dark mode is already merged and is part of the regression surface. Tremor is dead
(0 imports) and deletable; React 19 is already in place. Recommendation: keep agent work
on Tailwind v3 (port AI Elements components, or use antd-x), do v4 separately.

---

## How `useChat` reaches our backend

Not Vercel/Next-locked. Transport is pluggable; no BFF needed (the web app is pages-router
and talks directly to FastAPI today).

```ts
useChat({
  transport: new DefaultChatTransport({
    api: `${AGENTA_API}/.../invoke`,
    headers: { Authorization: apiKey },
    prepareSendMessagesRequest: ({ messages, id }) => ({
      headers: { "x-project-id": projectId },
      body: { messages, session_id: id, parameters: agentConfig }, // remap to Agenta shape
    }),
  }),
})
```

The one hard requirement: the endpoint must emit the **UI Message Stream protocol** (SSE).
ai-sdk explicitly supports non-JS backends; FastAPI can emit it via `StreamingResponse`.

---

## Backend streaming state (the real gate)

The agent backend does **not** currently emit a stream — it returns one buffered result,
at three points:

- `services/oss/src/agent_pi/ports.py`: `HarnessResult.output: str`, `invoke() -> HarnessResult`
- `services/agent/src/server.ts`: buffers request/response
- `services/oss/src/agent.py`: returns `{"role": "assistant", "content": result.output}`

But Pi already streams and the wrapper already consumes the deltas — it just accumulates
them:

```ts
// services/agent/src/runPi.ts:354
let streamed = ""
session.subscribe((event) => { streamed += event.assistantMessageEvent.delta ?? "" })
const output = streamed.trim() || extractAssistantText(session.messages)
```

So the BE work is forward-what's-already-captured + map to protocol + SSE relay, not
greenfield. Estimate ~2-4 days. Pi also exposes before/after tool hooks (the approval hook
point) and `fork()`/`importFromJsonl()` (sessions / fork-from-here).

**The SSE relay is not net-new — it already exists in the SDK serving layer.** The Agenta
Python SDK's `@workflow` routing layer already streams: when a handler returns an async
generator, `agenta/sdk/decorators/routing.py` negotiates format off the `Accept` header
(`text/event-stream` → SSE `data: <json>\n\n`, or `application/x-ndjson`/`jsonl` → NDJSON)
via `_make_stream_response` / `_sse_stream`, and sets `x-ag-trace-id` / `x-ag-span-id` /
`traceparent` headers (`WorkflowStreamingResponse` in `agenta/sdk/models/workflows.py`).
The catch: it is **protocol-agnostic** — it JSON-dumps whatever chunks the handler yields.
It does **not** emit the `x-vercel-ai-ui-message-stream: v1` header, the `data: [DONE]\n\n`
terminator, or any v6 part-type shape. So the SSE *transport* is done; only the **v6
framing on top of it** (yield v6-shaped part dicts + add the v6 header + `[DONE]`) is
net-new. This de-risks WP-1: the "real gate" is half-built. (This answers open validation
item #6 below.)

---

## Work packages + effort (fast path)

Effort = coarse human-dev-day ranges; Claude Code compresses the boilerplate.

| WP | Scope | Side | Effort | Risk |
|---|---|---|---|---|
| WP-0 spike | mock UIMessage stream → `useChat` → AI Elements render; confirm AI SDK 6 GA; confirm Pi before-tool hook can pause | FE+BE | 1-2 days | — |
| WP-1 BE streaming | forward Pi events → UIMessageStream chunks; SSE relay through FastAPI; preserve `traceparent` | BE | 2-4 days | Med |
| WP-2 FE transport + wiring | `prepareSendMessagesRequest`; Run/Send branch → `useChat.sendMessage`; config from entity atoms | FE | 3-5 days | Low |
| WP-3 rendering | wire AI Elements + inject trace/copy/rerun; light theme | FE | 2-4 days | Low |
| WP-4 tools under stream | verify `/tools/resolve` + `/tools/call` mid-stream | BE+FE | 2-3 days | Low |
| WP-5 sessions MVP | create-on-start; defer persistence/fork | FE+BE | 1-2 days | Low |
| WP-6 approvals (deferrable) | before-tool hook pause/resume + `addToolApprovalResponse` + confirm card | FE+BE | ~1 wk | Med |

Parallelized (FE on a mock stream while BE builds the emitter), MVP without approvals is
~2-2.5 weeks calendar, FE-light and BE-bound. Approvals add ~1 week.

---

## Open validation items (before locking direction)

- Confirm AI SDK 6 stable/GA status (the `needsApproval`/`addToolApprovalResponse` ergonomics are 6-era).
- WP-0 spike: AI Elements component on Tailwind v3 — port effort.
- WP-0 spike: Pi before-tool hook can gate a tool call.
- 1-hour spike: confirm the Lexical streaming perf claim if we ever consider our own renderer.
- Pin the Items/parts contract so backend output maps 1:1 to `UIMessage` parts (no translation layer).
- ~~Confirm whether the broader SDK serving layer has any chat-streaming path to borrow.~~
  **Resolved: yes.** The `@workflow` routing layer already does Accept-negotiated SSE/NDJSON
  relay from an async-generator handler (`agenta/sdk/decorators/routing.py`,
  `WorkflowStreamingResponse`). It's protocol-agnostic (no v6 header / `[DONE]` / part
  shapes), so borrow the transport, add the v6 framing. See "Backend streaming state" above.
- Decide edge topology: browser → FastAPI relay → agent service, vs browser → agent service direct.
- Daytona auto-stop (15 min idle) vs long streaming runs (BE infra).

---

## Transport / parallel lane

How the agent run reaches the backend, and how it diverges from the existing
completion/chat transport. Code-verified, not from memory.

### Current lane (what we branch from)

Despite the filename `webWorkerIntegration.ts`, there is **no web worker** — it is buffered
`fetch`. The body (config + inputs + references) is built by a reusable execution-item
builder; the agent lane should **reuse it**, not re-derive.

| Stage | What happens | File |
|---|---|---|
| Trigger | `triggerExecutionAtom`: resolve entity, comparison fan-out, headers (`executionHeadersAtom`→Bearer JWT), `projectId`, mode, clear prior responses, reconcile testcase row | `webWorkerIntegration.ts:169` |
| Build item | `stageHandle.run({get, headers, inputValues, references, links, projectId})` → `invocation.{invocationUrl, requestBody, headers}` | `executionRunner.ts:733` |
| Fetch | plain `fetch(POST, JSON.stringify(requestBody))` then `response.json()` — **buffered, no stream** | `executionRunner.ts:908` |
| Normalize | `normalizeWorkflowResponse` → `{output, trace}`; trace_id read from **response body** (`data.trace_id`) | `responseHelpers.ts:23` |
| Route result | chat mode → `handleExecutionResultAtom` writes assistant/tool messages to the flat store | `webWorkerIntegration.ts:482` |

Request the backend receives:

```jsonc
// POST {runtimePrefix}{/routePath}/test?application_id=…&project_id=…
{
  "ag_config": { "prompt": { "messages": [...system...], "llm_config": { "model": "...", "tools": [...] } } },
  "inputs":     { /* template vars (completion) */ },
  "messages":   [ /* chat history (chat mode) */ ],
  "references": { "application": {id,slug}, "application_variant": {...}, "application_revision": {id,slug,version} }
}
```

Sourcing facts that matter:
- `project_id` and `application_id` are **URL query params**, not headers/body (`executionItems.ts:1136`).
- `references` are built from the revision with local-draft ids stripped (`isLocalDraftId` → backend 422 on non-UUIDs) (`executionRunner.ts:216`, `:314`).
- `ag_config` is **draft-aware**: read from `workflowMolecule.selectors.configuration` (merged draft+server) (`executionItems.ts:666`).
- Auth injected via `executionHeadersAtom` (Bearer JWT), set once at OSS app init.

### What the agent lane reuses vs replaces

| Concern | Current | Agent lane | Reuse? |
|---|---|---|---|
| URL + body + headers + references | `createExecutionItemHandle().run()` | same builder | reuse |
| Config source (draft-aware) | workflow molecule | same | reuse |
| Auth / projectId / appId query params | `executionHeadersAtom` + query | same | reuse |
| Transport | buffered `fetch` + `response.json()` | `useChat` streaming → `/stream` endpoint | replace |
| Response normalize | `normalizeWorkflowResponse` | useChat parses UI Message Stream | replace |
| trace_id delivery | response body | stream metadata (`messageMetadata`) | replace |
| Message store | `handleExecutionResultAtom` → flat store | useChat owns messages (no mirror) | bypass |
| Comparison fan-out | multi-entity loop | single conversation | bypass |

### Integration code (reuse our builder, feed useChat)

```tsx
import {useChat, DefaultChatTransport} from "@ai-sdk/react"
import {getDefaultStore} from "jotai"
import {projectIdAtom} from "@agenta/shared/state"
import {createExecutionItemHandle} from "@agenta/playground/state/execution/executionItems" // reuse (may need export)
import {executionHeadersAtom} from "@agenta/playground/state/execution/webWorkerIntegration"
import {derivedLoadableIdAtom} from "@agenta/playground/state/execution/selectors"

function useAgentChat(entityId: string) {
  const store = getDefaultStore()

  return useChat({
    transport: new DefaultChatTransport({
      prepareSendMessagesRequest: async ({messages}) => {
        const get = store.get
        const getHeaders = get(executionHeadersAtom)
        const headers = getHeaders ? await getHeaders() : {}
        const projectId = get(projectIdAtom)

        // Build the SAME invocation a normal run builds — body carries
        // ag_config (draft-aware), references, and query params on the URL.
        const item = createExecutionItemHandle({
          loadableId: get(derivedLoadableIdAtom)!,
          rowId: "agent",
          entityId,
          runId: `run-${Date.now()}`,
        }).run({
          get,
          headers,
          repetitions: 1,
          inputValues: {messages: messages.map(toAgentaMessage)}, // UIMessage.parts → {role,content}
          projectId, // references pulled from requestPayload inside buildRequestBody
        })!

        return {
          api: item.invocation.invocationUrl.replace(/\/test(\?|$)/, "/stream$1"), // streaming endpoint
          headers: {...item.invocation.headers, ...headers},
          body: item.invocation.requestBody, // { ag_config, inputs, messages, references }
        }
      },
    }),
  })
}
```

trace button, reusing the existing global atom (ties to the rendering section above):

```tsx
// BE (TS agent service): toUIMessageStreamResponse({ messageMetadata: () => ({ traceId }) })
// FE: per-message action
<Action label="Trace" onClick={() =>
  getDefaultStore().set(openTraceDrawerAtom, {traceId: message.metadata?.traceId})
} />
```

### Surprises to avoid (each is a real code fact)

| # | Surprise | Why | Mitigation |
|---|---|---|---|
| 1 | Default `{messages}` body drops **references** → agent traces never surface on the app trace page | refs built from the revision, not the messages | reuse the execution-item builder |
| 2 | `project_id`/`application_id` go on the **URL query**, not headers/body | `executionItems.ts:1136` | keep them on `api`, not in `body` |
| 3 | Local-draft ids in references → backend **422** | `isLocalDraftId` strip, `executionRunner.ts:314` | builder strips; don't hand-roll refs |
| 4 | `reconcileRowDataForEntity` strips keys not in the input contract | chat keeps `messages`; agent schema must allow it | confirm agent input contract includes `messages` |
| 5 | Enhanced-value wrappers (`__id`/`__metadata`) must be stripped | `stripAgentaMetadataDeep` in `buildRequestBody` | builder handles it; a hand-rolled body would not |
| 6 | trace_id arrives in the **response body** today, gone under streaming | `normalizeWorkflowResponse` reads `data.trace_id` | emit as stream `messageMetadata` |
| 7 | Agent URL resolution rides the **custom-workflow** path until WP-6 | agent registers auto URI `user:custom:…` (`agent.py:351`) | confirm `/stream` route + routePath resolution |
| 8 | Run button calls `triggerExecutionAtom` (fans out comparison) | agent is single-conversation | branch agent variants to `useAgentChat.sendMessage` |

### Flow

```
[Run/Send for agent variant]
        │  (branch: not triggerExecutionAtom)
        ▼
useAgentChat(entityId) ──reuses──▶ createExecutionItemHandle().run() ──▶ { url, body(refs+ag_config), headers }
        │  DefaultChatTransport → POST /stream (UI Message Stream SSE)         │
        ▼                                                                      ▼
useChat owns messages ──parts──▶ AI Elements render          BE: TS agent service maps Pi events
        │                                                     → UIMessageStream + messageMetadata{traceId}
        ▼
trace/copy/rerun injected via existing atoms (openTraceDrawerAtom)
```

Net: reuse the body builder, swap the buffered fetch for useChat's streaming transport,
move trace_id into stream metadata, bypass the chat message store. The references / config
/ auth ride the existing execution-item builder — the one thing the agent lane shares with
the completion/chat lane.

Verify before building: (1) `createExecutionItemHandle` is exported from the package (or
export it); (2) `prepareSendMessagesRequest` can override `api` per request for the
query-param URL (else use the transport's `fetch` hook).

---

## Contract-proving slice (plan + first-cut contract)

Status: agreed approach (contract-complete scope).

**The contract v1 IS the functional page, not a written spec.** The primary handover
artifact is a working streaming chat page (real `useChat` stream against the RAG_QA custom
workflow), with tools and one approval. The written contract below is its companion: it
annotates what the page proves and seeds the conversation. Mahmoud and FE iterate the
contract on the running page, then Mahmoud re-points the same page at the agent workflow he
builds until it behaves identically (parity). The executable page must not be left out of
the handover — it is the deliverable.

### Why this exists

The hardest part of the FE/service/backend split is the wire contract. We prove it with a
thin vertical slice before both sides commit. The chosen backend is the existing
`examples/python/RAG_QA_chatbot/backend/main.py`, verified to emit the **v6 UI Message
Stream Protocol** (`x-vercel-ai-ui-message-stream: v1`, frontend on `ai@6.0.0-beta.150` /
`@ai-sdk/react@3.0.0-beta.153`). It already streams text, `source-url`, and a custom
`data-trace` part — the trace-injection seam, in working code.

### Work packages

| WP | Scope | Owner |
|---|---|---|
| **S1 FE slice** | Real feature-flagged app page. `useChat` rendering the full part set: text, tool-call lifecycle, one approval. FE renders tool calls, does NOT execute them. Trace via `data-trace` → `openTraceDrawerAtom`. | FE |
| **S2 service** | Extend the RAG_QA example: keep text/source/trace, **add** tool-call parts + one mocked `approval-requested` round-trip. Mock tool execution; mirror the real v6 part lifecycle. | FE |
| **S3 contract** | The written contract below, proven by S1+S2. | FE+Mahmoud sign-off |
| **Handoff → real streaming** | Build streaming into the ACP agent workflow against the contract, incl. the **FastAPI↔agent-service relay** (the hop the slice can't prove). | Mahmoud |
| **Agent generation** | Build agent generation in the playground against the contract (mock stream), parallel to the handoff, then integrate. | FE |

### Handover (what Mahmoud receives)

The handover is executable-first:

1. **The functional page (primary).** A working streaming chat page against the RAG_QA
   service, rendering text + tool calls + one approval + trace. This is contract v1 — a
   running thing both sides poke at, not a paper spec.
2. **The companion contract doc (secondary).** The first-cut below, annotating what the
   page demonstrates and listing the open questions. It travels with the page; it does not
   replace it.
3. **Parity as the success criterion.** Mahmoud points the **same page** at the agent
   workflow he builds. When the page renders the agent run identically (text, tool calls,
   approval, trace) with no FE changes, the contract holds. Divergence at that point is a
   contract bug, found cheaply, against a known-good reference.

This is why the page can't be skipped for a written spec alone: the spec can be wrong in
ways only a running stream reveals, and parity-against-a-reference is the cheapest way for
Mahmoud to know his service matches.

### S3 contract — first cut

**Transport.** `POST` an SSE endpoint returning `Content-Type: text/event-stream` with
header `x-vercel-ai-ui-message-stream: v1`. Each event is `data: <json>\n\n`; stream ends
with `data: [DONE]\n\n`.

**Stream parts** (`type` field per event). All rows below are now **proven** — exact
field names taken from the installed `ai@6.0.0-beta.150` types and exercised end to end by
the slice (the RAG_QA contract mock emits them; the real `Chat` engine `useChat` wraps
consumes them). The earlier "v6-docs / confirm shape" hedges are resolved:

| wire `type` | Carries | Notes |
|---|---|---|
| `start` | `messageId?`, `messageMetadata?` | metadata is an alternate trace channel (see below) |
| `text-start` / `text-delta` / `text-end` | `id`, `delta` | |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | `id`, `delta` | client part state ends at `done` |
| `source-url` | `sourceId`, `url`, `title?` | |
| `tool-input-start` | `toolCallId`, `toolName` | |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` | streams a partial JSON input |
| `tool-input-available` | `toolCallId`, `toolName`, `input` | |
| `tool-approval-request` | `approvalId`, `toolCallId` | **this is the approval chunk** (not `approval-requested`) |
| `tool-output-available` | `toolCallId`, `output`, `preliminary?` | matched to the existing part by `toolCallId` |
| `tool-output-denied` | `toolCallId` | emitted on resume when the user denied |
| `tool-input-error` / `tool-output-error` | `toolCallId`, `errorText` | |
| `data-trace` | `data: { traceId, url }` (our trace part) | send `traceId` explicitly — the drawer needs an id, not a url |
| `finish` | `finishReason?`, `messageMetadata?` | terminal; followed by `data: [DONE]\n\n` |

**Correction (live-stream finding):** the wire chunk that pauses for approval is
`tool-approval-request { approvalId, toolCallId }`, **not** a top-level `approval-requested`
event. `approval-requested` / `approval-responded` are the *client part states*, not wire
types. The first cut conflated the two.

On the client, these collapse into `message.parts[]`: `text`, `reasoning`,
`tool-<toolName>` (a `ToolUIPart` whose `state` walks `input-streaming` → `input-available`
→ `approval-requested` → `approval-responded` → `output-available` | `output-denied` |
`output-error`, carrying `approval: {id, approved?, reason?}` in the approval states),
`source-url`, and `data-trace`.

**Request body** (what the FE sends; the contract includes the real fields even though the
slice may mock transport):

```jsonc
{
  "messages": [ { "role": "user", "parts": [ { "type": "text", "text": "..." } ] } ],
  "ag_config": { "prompt": { "messages": [...system...], "llm_config": { "model": "...", "tools": [...] } },
                 "harness": "pi", "sandbox": "local" },   // harness/sandbox per PR #4721 AgentConfigControl
  "references": { "application": {id,slug}, "application_variant": {...}, "application_revision": {...} },
  "session_id": "<chat id / Agenta session_id>"
}
```

Query params (not body): `application_id`, `project_id`. Header: `Authorization`.

The slice builds this with `DefaultChatTransport` + `prepareSendMessagesRequest`, which
returns `{ body, headers?, api? }`. `session_id` is the `useChat` chat `id`. In the slice,
`ag_config`/`references` are stubbed (mocked transport); on the real page they come from the
execution-item builder. The `messages` field above shows **Track A** — see the next section
for the open A/B decision on its shape.

### Request message contract — two tracks (open decision, built both ways)

The first cut of this doc was internally inconsistent on the `messages` shape: the
"Transport / parallel lane" section adapts `UIMessage.parts → {role, content}`
(`messages.map(toAgentaMessage)`, to reuse the existing builder), while the S3 body above
sends raw `parts`. That inconsistency is not a typo — it is an **unmade architectural
decision**: does the new agent service adopt the AI SDK `UIMessage` shape, or conform to the
`{role, content}` contract the existing Agenta runtime (`chat.py`, `completion.py`, the
execution-item builder) already speaks? Rather than pick, the slice **implements both** so
the team can compare them on a running stream and decide. The **response** stream is
byte-for-byte identical across tracks — only the request body (and how the mock reads it)
differs. The slice page has a runtime A/B toggle.

| | **Track A — `UIMessage` parts** | **Track B — Agenta `{role, content}`** |
|---|---|---|
| Endpoint | `POST /api/agent/chat` | `POST /api/agent/chat-agenta` |
| `messages[]` | `{role, parts:[{type:"text",…},{type:"tool-…",…}]}` (posted verbatim) | `{role, content}` + OpenAI `tool_calls` + `{role:"tool",tool_call_id,content}` results |
| Approval decision | inside the assistant message's tool part (`state:"approval-responded"`, `approval:{id,approved}`) | **side field** `tool_approvals:[{tool_call_id, approved}]` (no slot for it in the message contract) |
| `reasoning` | preserved as a `reasoning` part | dropped (no field in `{role, content}`) |
| FE cost | none — `useChat` output posted 1:1 | a translation layer (`toAgentaMessage`) + a net-new approval convention |
| Backend cost | service must speak AI SDK parts (diverges from chat/completion) | uniform contract across all workflow types |
| What it honors | JP's "output maps 1:1 to `UIMessage` parts, no translation layer" | backend contract uniformity (reuse the builder, one message shape everywhere) |

The tension is exactly **zero-translation FE (A)** vs **uniform backend contract (B)** — a
call for Mahmoud + JP, not the FE owner. Both were verified end to end (text + tool +
approve + deny + trace) through the real `Chat` engine `useChat` wraps; both render the
identical part set. Code: Track A is the default transport; Track B's adapter is
`web/oss/src/components/AgentChatSlice/assets/toAgentaMessage.ts`; the mock parses both in
`examples/python/RAG_QA_chatbot/backend/contract_stream.py`.

**Track B finding (a cost only building it surfaced):** the Agenta message contract has
**no slot for an approval decision** — approvals are net-new (`AgentRunRequest` carries only
`permissionPolicy`, no per-call response). So Track B must *invent* one (`tool_approvals`
here). Track A gets it for free because the decision lives in the message parts. If the team
values the human-in-the-loop approval ergonomics, that weighs toward A; if it values one
backend message contract across completion/chat/agent, that weighs toward B.

**Approval round-trip (proven).** `tool-approval-request` finishes the turn with the tool
part in `approval-requested`. The FE calls `addToolApprovalResponse({ id, approved, reason })`
(`id` = `approvalId`); the part flips to `approval-responded` with `approval: {id, approved}`.
Auto-resume is wired with `useChat({ sendAutomaticallyWhen:
lastAssistantMessageIsCompleteWithApprovalResponses })`, which re-POSTs the full history.
The service detects the `approval-responded` tool part in `messages` and streams
`tool-output-available` (approved) or `tool-output-denied` (denied). **The resumed output
lands on the SAME assistant message** (matched by `toolCallId`), so one assistant message
can accumulate: original text → tool calls → resolved tool output → resume text → a second
`data-trace`. The trace action should therefore pick the **last** `data-trace` part.

**Trace convention (refined by the live stream).** `openTraceDrawerAtom` takes a
**`traceId`, not a URL**. The original RAG_QA example sent only `data-trace { data: { url } }`,
so the service should send `data-trace { data: { traceId, url } }` (the slice mock now does);
the FE prefers `data.traceId` and falls back to parsing the last path segment of `url`.
`message.metadata.traceId` (via `start`/`finish` `messageMetadata`) is a viable alternate
channel. No response-body trace field (buffered-only, dies under streaming).

**Error shape.** Tool-level: `tool-output-error` part. Run-level: a terminal error part or
HTTP non-2xx before the stream opens. Settle the exact run-level error envelope with Mahmoud.

**Open contract questions for Mahmoud:**
1. ~~Exact v6 approval part shape~~ — **resolved by the slice**: wire chunk
   `tool-approval-request { approvalId, toolCallId }`; decision via
   `addToolApprovalResponse({ id, approved, reason })`; resume detects the
   `approval-responded` part and emits `tool-output-available` / `tool-output-denied`.
2. **Request message contract: Track A (`UIMessage` parts) vs Track B (Agenta
   `{role, content}` + `tool_approvals`)** — built both ways (see "Request message contract
   — two tracks"). The decision (zero-translation FE vs uniform backend contract) is for
   Mahmoud + JP.
3. Run-level error envelope (mid-stream failure vs pre-stream 4xx/5xx).
4. Where `session_id` is minted (FE-generated vs service-issued) and whether it persists.
5. `references` + `ag_config` passthrough: does the agent service echo them onto the trace as today's `/test` path does.
6. Relay specifics: does FastAPI pass the SSE through verbatim, preserving `traceparent`.

### What the live stream changed (slice findings)

The slice (`web/oss` route `…/agent-chat`, component `components/AgentChatSlice/`, mock
`examples/python/RAG_QA_chatbot/backend/contract_stream.py`) corrected the first cut on
exactly the points only a running stream reveals:

- Approval is the `tool-approval-request` **wire chunk**, not an `approval-requested` event
  (that name is a client part *state*). Denial resume chunk is `tool-output-denied`.
- The trace part must carry a `traceId` (the drawer can't use a bare URL).
- Approve **and** deny round-trips both verified through the real `Chat` engine `useChat`
  wraps (headless), against the live mock: text → reasoning → sources → auto-tool lifecycle
  → approval → resumed output/denial → trace. `ai@6.0.0-beta.150` + `@ai-sdk/react@3.0.0-beta.153`
  run on React 19 (web/oss), not just the example's React 18.
- The doc's `messages`-shape inconsistency turned out to be an unmade decision, so the slice
  ships **both** request contracts (Track A / Track B) behind a toggle — verified that both
  drive the identical response/render. Track B surfaced that the Agenta message contract has
  no slot for an approval decision (needs the `tool_approvals` side channel).

### Residual risks

- **v6 beta** (`6.0.0-beta.150`): pin exact versions; keep the contract protocol-level so API churn doesn't reopen it.
- **Slice proves FE↔edge only**: the FastAPI↔agent-service relay is unproven until the handoff. A green slice can still hide a relay failure.
- **In-app browser render not exercised against a live stack**: the contract was proven via
  the real SDK engine (headless) and the route compiles + serves 200 under `next dev`, but a
  full click-through needs the authenticated docker-compose dev stack (backend + DB + auth).
  The renderers are pure functions of `message.parts`, which the engine is proven to produce.

### Running the slice (handover)

Credential-free — the mock has no Qdrant/OpenAI/Agenta dependency.

**1. Service** (the contract mock):

```bash
cd examples/python/RAG_QA_chatbot
python3 -m venv .venv && .venv/bin/pip install fastapi 'uvicorn[standard]'
.venv/bin/uvicorn backend.contract_main:app --port 8000
# POST /api/agent/chat emits the full v6 part set incl. tool + approval.
# The real RAG_QA main.py also mounts this router (needs the full env to boot).
```

**2. Frontend** (the page):

```bash
cd web && NEXT_PUBLIC_AGENT_CHAT_SLICE=true pnpm --filter @agenta/oss dev
# visit  …/w/<ws>/p/<project>/agent-chat
```

Flip the **A · UIMessage parts / B · Agenta {role,content}** toggle on the page (or set
`NEXT_PUBLIC_AGENT_CHAT_TRACK=agenta` for the default) and watch the Network tab to compare
the two request contracts on the same stream. Override `NEXT_PUBLIC_AGENT_CHAT_API` to
re-point the same page at the real agent workflow for parity testing. Code:
`web/oss/src/components/AgentChatSlice/` + route
`web/oss/src/pages/w/[workspace_id]/p/[project_id]/agent-chat/index.tsx`.

### Assignment

Draft and circulate the S3 contract above as a one-pager before writing slice code, so
S1/S2 build to a spec and the handoff + agent-generation work can run in parallel.

---

## Key file references

Frontend rendering:
- `web/packages/agenta-playground-ui/src/components/ExecutionItems/assets/ChatTurnView/index.tsx`
- `web/packages/agenta-playground-ui/src/components/adapters/TurnMessageAdapter.tsx`
- `web/packages/agenta-ui/src/Editor/Editor.tsx` (Lexical hydration)
- `web/packages/agenta-ui/src/SharedEditor/` (controlled value sync)
- `web/packages/agenta-playground-ui/src/components/ToolCallView/index.tsx`

Frontend state / features:
- `web/packages/agenta-playground/src/state/execution/types.ts` (`RunResult`)
- `web/packages/agenta-playground/src/state/chat/messageTypes.ts` (`MessageExecution`)
- `web/oss/src/components/SharedDrawers/TraceDrawer/store/traceDrawerStore.ts` (`openTraceDrawerAtom`)
- `web/oss/src/components/SharedGenerationResultUtils/index.tsx`
- `web/packages/agenta-entities/src/workflow/state/appUtils.ts` (`is_chat` for agent)

Backend:
- `services/oss/src/agent.py` (handler, single-result)
- `services/oss/src/agent_pi/ports.py` (`Harness`, `HarnessResult`)
- `services/agent/src/runPi.ts` (Pi event subscribe, delta accumulation)
- `services/agent/src/server.ts` (HTTP wrapper)

Config:
- `web/oss/tailwind.config.ts` (`preflight:false`, regex safelist, antd JS tokens)
