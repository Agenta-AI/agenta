# `@agenta/chat` headless core — dissection & contract

Companion to [design.md](./design.md) (decision g). Grounded in a line-level dissection of the
current `AgentChatSlice` (2026-07-12). This is the working reference for WP3a.

Legend: **E** = Engine (packaged/pure, reuse as-is) · **B** = Behavior (belongs in the headless
layer; today inline in components) · **P** = Presentation (skin owns).

## 1. Classification of current responsibilities

| Responsibility | Class | Where it lives today |
|---|---|---|
| Stream transport (stream↔batch negotiation, batch replay) | E | `assets/AgentChatTransport.ts` + `createNegotiatingFetch`, `agentChannelModeAtom` (`@agenta/playground`) |
| Request building (config/auth/references → body) | E | `buildAgentRequest` (`@agenta/playground`) |
| Turn capture, resume-after-approval, queue release gates | E | `@agenta/playground` `execution/*` (pure) |
| Render-hint map (`data-render` → `render.kind`) | E | `buildRenderMap`, `renderKindFor` (`execution/renderMap.ts`) |
| Transcript replay (records → `UIMessage[]`) | E | `assets/transcriptToMessages.ts` + `loadSession.ts` |
| Tool display resolution / value formatting | E | `assets/toolDisplay.ts`, `assets/toolFormat.ts` (pure registries) |
| Tool output summarization | B | inline in `ToolActivity.tsx:49-89` — pure logic trapped in a presentational file |
| Attachment validation / encoding | E | `assets/attachments.ts`, `assets/files.ts` (File-based, pure) |
| Attachment **state** shape | B/leak | antd `UploadFile` in `AgentConversation.tsx:358-370` and `state/sessionEphemera.ts:1,29` |
| Trace/usage extraction from metadata | E | `assets/trace.ts` |
| Session model + ephemera + expand state | E (leaks) | `state/sessions.ts`, `state/sessionEphemera.ts` (holds `UploadFile` + virtuoso `StateSnapshot`), `state/expandState.ts` |
| Turn grouping (active turn, lastUserIndex) | B | `AgentConversation.tsx:1677-1685` |
| Empty-turn collapsing predicates | B | `AgentConversation.tsx:167-179,1728` |
| Turn render model (tool folding, superseded-gate dedup, client-tool split) | B | `AgentMessage.tsx:329-416` |
| hasAnswer/noResponse/error derivation | B | `AgentMessage.tsx:270-312` |
| Client-tool dispatch registry | E→registry | `components/clientTools/{registry,meta}.tsx` (widgets are P) |
| Approval extraction (`getPendingApprovals`) | B | `ApprovalDock.tsx:33-45` |
| Approval body registry (by tool name) | E→registry | `components/approvals/registry.tsx` (bodies are P) |
| Queue orchestration | E (hook) | `hooks/useAgentChatQueue.ts` — the template for headless hooks |
| Model-key gate | E (hook) | `hooks/useAgentModelKeyStatus.ts` |
| Hydration sequencing (seed → skeleton vs hero → server hydrate → SWR revalidate) | B | `AgentConversation.tsx:571-603,891-913` |
| Session-status derivation + publish (error>awaiting>running>idle) | B | `AgentConversation.tsx:561,991-1004` |
| Error stamping onto turn | B | `AgentConversation.tsx:1025-1052` + `parseAgentRunError:191` |
| Persist-on-settle + expand-prune | B | `AgentConversation.tsx:1055-1082` |
| Self-commit / committed-revision handling | B | `AgentConversation.tsx:1090-1118` |
| Rewind orchestration | B (+E core, P confirm) | `AgentConversation.tsx:1637-1672`; pure scan in `assets/rewind.ts`; `modal.confirm` is P |
| Client-tool output settle → `addToolOutput` | B | `AgentConversation.tsx:616-635` |
| Elicitation parsing/validation/envelopes | E | `@agenta/shared/utils` (already extracted; only field rendering is antd) |
| Scroll engineering (SC-1..4, anchor, jump pill, virtuoso) | B, desktop-only | `AgentConversation.tsx:465-488,1140-1497` (~350 lines) — mobile uses native scroll |
| Bubble/avatar/toolbar, tool rows, approval chrome, queued chips, tray, empty/skeletons, markdown | P | `components/*`, `assets/markdown.tsx` (antd/x + Prism) |
| Right panel, turn inspector, onboarding hero, template strip | P, desktop/onboarding-only | already null-gated |

`AgentConversation.tsx` is roughly **65% behavior / 35% presentation**; the behavior is almost
entirely app-agnostic. Onboarding, build mode, inspectors, and virtualization are all cleanly
gated (nullable context / atoms / env flags) — the mobile skin simply omits them.

## 2. antd/desktop type leaks to neutralize

1. **`UploadFile` as canonical attachment state** — `AgentConversation.tsx:358-370,499-516`,
   `state/sessionEphemera.ts:1,29`, `ComposerAttachments.tsx:13,26`. Core moves to `File[]` (or
   neutral `PendingAttachment{file, uid, name}`); `filesToParts`/`validateIncoming` are already
   File-based.
2. **`Bubble<ReactNode>` prop shaping** in `AgentMessage.tsx:630-648` + the loading-bubble
   placeholders (`AgentConversation.tsx:1925-1930`) — stays in the desktop skin.
3. **antd-x `Actions` items as toolbar data** — `AgentMessage.tsx:561-618`. Contract uses neutral
   `{key, label, icon, onClick}[]` action descriptors.
4. **react-virtuoso types in shared state** — `StateSnapshot` in `sessionEphemera.ts:2,21`,
   `state/virtualization.ts`. Desktop-local; moves out of the shared store.

Minor: `Modal.useModal` for the rewind confirm (core returns a `RewindPlan`, skin renders the
confirm), `App.useApp` toasts, antd `Form` inside `ElicitationWidget` (contract logic already in
`@agenta/shared/utils` — the cleanest existing example of the desired split).

## 3. Headless hooks (Layer 2 API sketch)

```ts
useAgentConversation({entityId, sessionId}): {
  messages: UIMessage[]
  status: "ready" | "submitted" | "streaming" | "error"
  runStatus: "idle" | "running" | "awaiting" | "error"
  error?: ParsedRunError
  turns: TurnViewModel[]                       // pre-grouped: active turn, empty-collapse
  send(input: {text: string; files?: File[]}): void   // routes through the queue
  stop(): void
  regenerate(id: string): void
  rewind(message: UIMessage): RewindPlan       // {sideEffects[], confirm()} — skin renders confirm
  isHydrating: boolean
  isEmpty: boolean
}

useTurnRenderModel(message, ctx): RenderItem[]        // lifted from AgentMessage.tsx:329-416
useComposerAttachments({sessionId, limits}): {files, rejections, add, remove, clear, atMax, toParts}
useSessionHydration({sessionId})
useApprovalDock({messages, onRespond}): {current, count, respond, approveAll, renderer}
useClientToolDispatch()
useAgentChatQueue(...)            // exists — moves in
useAgentModelKeyStatus(...)       // exists — moves in
useConversationScroll(ref, {messages, status})        // DESKTOP-ONLY opt-in
```

## 4. Skin slot contract (Layer 3)

Every slot receives data + callbacks only — no antd/x types. Registry keys are the existing
ones: `renderKindFor(...)` → client-tool widget; tool name → approval body;
`resolveToolDisplay(rawName)` → label/source/kind; expand keys from `expandState.ts`.

| Slot | Props (from behavior layer) |
|---|---|
| `MessageBubble` | `{role, variant, avatar, children, isError}` |
| `TextPart` | `{markdown}` |
| `ReasoningPart` | `{text, streaming, expanded, onToggle}` |
| `FilePart` | `{name, kind: FileKind, url, mediaType}` |
| `SourcesList` | `{sources: {url, title?}[]}` |
| `ToolActivityGroup` | `{parts, mode: "summary"\|"live"\|"detailed", summaryLabel, failedCount, expanded, onToggle, onViewTrace?}` |
| `ToolRow` | `{name, displayLabel, source?, status, midText, io?, expanded, onToggle}` |
| `ApprovalCard` | `{current, count, headline?, approveLabel?, Body?, onApprove, onDeny, onApproveAll, onViewTrace?}` |
| approvals registry entry | tool name → `{Body(input, entityId, fallback), headline?, approveLabel?}` |
| clientTool registry entry | `render.kind` → toolName → widget `{meta, settle, degradedEarlierInTurn}` |
| Elicitation fields | per schema kind (string/number/enum/date/boolean/array); engine parses, skin draws |
| `ErrorPart` | `{text, expanded, onToggle}` |
| `NoResponseNotice` | `{}` |
| `QueuedChip` / `QueuedList` | `{queued, onRemove, onClear}` |
| `Composer` | `{onSubmit(text), disabled, streaming, onStop, placeholder, initialMarkdown, onChange, onPasteFile, prefix, header, trailing}` |
| `AttachmentTray` | `{files, rejections, limits, onAdd, onRemove, onDismissRejections}` |
| `EmptyState` | `{entityId, onStart, firstRunPrompt?, canStart, onPrefill?}` |
| Skeletons | transcript / composer / conversation |
| `MessageToolbar` | `{actions: {key, label, icon, onClick}[]}` |
| `JumpToLatestPill` (desktop) | `{visible, onClick}` |
| `WorkingIndicator`, `MessageTimestamp`, `TraceMetrics` | `{}` / `{createdAt}` / `{traceId?, usage?}` |
| `DropOverlay`, `DockContainer` | layout slots |

## 5. WP3a extraction order

1. Neutralize the four type leaks (§2) — behavior-neutral, OSS keeps working.
2. Lift the pure blocks (turn render model, status/error derivation, tool summarization,
   approval extraction, hydration) into `@agenta/chat`; OSS re-imports them immediately
   (before/after fixture tests prove identical output).
3. Assemble `useAgentConversation` from the lifted blocks + engine (mobile-first consumer).
4. Generalize the three registries so skins register values against shared keys.
5. Desktop re-plumb of the remaining inline host (scroll opt-in, JSX assembly) = follow-up
   track, and the contract's acceptance test.
