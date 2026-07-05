import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react"

import {invalidateAgentCommittedRevisionCache} from "@agenta/entities/workflow"
import {
    agentShouldResumeAfterApproval,
    buildAgentRequest,
    buildTurnCapture,
    playgroundController,
} from "@agenta/playground"
import {Button} from "@agenta/primitive-ui/components/button"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {generateId} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import {useConfirmDialog} from "@agenta/ui/components/modal"
import {RichChatInput, type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useChat} from "@ai-sdk/react"
import {Bubble} from "@ant-design/x"
import {ArrowDown, Paperclip, TreeStructure, UploadSimple} from "@phosphor-icons/react"
import {type UIMessage} from "ai"
import {Tabs, Tag} from "antd"
import type {UploadFile} from "antd"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {SessionInspectorButton} from "@/oss/components/SessionInspector"
import {openTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"

import {AgentChatTransport} from "./assets/AgentChatTransport"
import {
    type AttachmentRejection,
    DEFAULT_ATTACHMENT_LIMITS,
    validateIncoming,
} from "./assets/attachments"
import {filesToParts} from "./assets/files"
import {messageText, sideEffectingToolsInRange} from "./assets/rewind"
import {getMessageTraceId} from "./assets/trace"
import AgentChatEmptyState from "./components/AgentChatEmptyState"
import AgentMessage from "./components/AgentMessage"
import ApprovalDock, {getPendingApprovals} from "./components/ApprovalDock"
import type {ClientToolOutputHandler} from "./components/clientTools"
import ComposerAttachments from "./components/ComposerAttachments"
import QueuedMessages from "./components/QueuedMessages"
import SessionHistoryMenu from "./components/SessionHistoryMenu"
import SessionRail from "./components/SessionRail"
import SessionTagBar from "./components/SessionTagBar"
import TurnInspector from "./components/TurnInspector/TurnInspector"
import {useAgentChatQueue, type QueuedMessage} from "./hooks/useAgentChatQueue"
import {chatPanelMaximizedAtom} from "./state/panelLayout"
import {useChatScopeKey} from "./state/scope"
import {
    type SessionRunStatus,
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    closeSessionAtomFamily,
    persistSessionMessagesAtom,
    renameSessionAtomFamily,
    sessionMessagesAtom,
    sessionsListAtomFamily,
    setActiveSessionAtomFamily,
    setSessionStatusAtom,
    stampMessagesCreatedAtAtom,
} from "./state/sessions"
import {captureTurnRequestAtom} from "./state/turnCaptures"
import {turnInspectorAtom} from "./state/turnInspector"

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
const ignoreStreamRejection = () => {}

/** Height of the top-edge fade, in px. Shared by the CSS mask and the SC-1 pin so a pinned turn
 * lands BELOW the fade (otherwise the freshly-asked question renders partially faded). */
const TOP_FADE_PX = 28
/** Height of the bottom-edge fade, matching the top so content dissolves into the composer edge. */
const BOTTOM_FADE_PX = 28
/** Edge fades for the message scroll area: transparent at the very top, fully opaque by TOP_FADE_PX,
 * then fading back to transparent over the last BOTTOM_FADE_PX. Applied as a CSS mask so the content
 * itself fades (correct in any theme). */
const EDGE_FADE_MASK = `linear-gradient(to bottom, transparent 0, #000 ${TOP_FADE_PX}px, #000 calc(100% - ${BOTTOM_FADE_PX}px), transparent 100%)`
/** Centered reading column for the chat body. Caps line length / bubble width so a wide (maximized)
 * panel doesn't sprawl into oversized bubbles and over-spaced turns; freed side space is whitespace. */
const CHAT_COLUMN = "mx-auto w-full max-w-[880px]"
/** Full-screen session rail width. The rail slides between this and 0 (rather than mounting) so the
 * Build/Chat transition stays cohesive with the config pane's animated collapse. */
const RAIL_WIDTH = 248

/**
 * One agent conversation for a single session tab. A `useChat` whose transport is fed by the
 * PLAYGROUND request builder (`buildAgentRequest`) — the entity supplies the config/auth/
 * references, the session id is the tab's id and travels to the backend as `session_id`.
 * Messages persist to localStorage (seeded on mount, written when the stream settles) so the
 * tab survives a reload / revision swap.
 *
 * Design decisions baked in (docs/design/agent-workflows/playground-agent-generation.md):
 *  - D9  teardown: abort the in-flight stream on unmount (tab close / revision swap).
 *  - DT3 cancelled state: a stopped stream tags its partial bubble "Stopped" + offers Resend.
 *  - DT4 autoscroll: stick to bottom while streaming; pause when scrolled up; "jump to latest".
 *  - DT5 a11y: the message log is an aria-live region; controls are keyboard-operable.
 */

/** A settled assistant turn with no content at all — no answer, reasoning, tool, file, or
 * source part. Mirrors AgentMessage's `!hasContent`; used to collapse a run of "no response"
 * bubbles (e.g. repeated failed runs) down to the first one. */
const isEmptyAssistantTurn = (m: UIMessage): boolean =>
    m.role === "assistant" &&
    !m.parts.some(
        (p) =>
            (p.type === "text" && Boolean((p as {text?: string}).text?.trim())) ||
            (p.type === "reasoning" && Boolean((p as {text?: string}).text?.trim())) ||
            p.type === "file" ||
            p.type === "source-url" ||
            p.type.startsWith("tool-") ||
            p.type === "dynamic-tool",
    )

interface ParsedRunError {
    message: string
    code?: number
}

/**
 * Best-effort human reason from a useChat stream error. The server may hand us a clean string
 * ("Agent run failed: …") or a JSON envelope (`{status:{code,message,…}}` / `{message}`) — pull
 * the message out of either and drop the stacktrace / docs-url noise so it reads cleanly inline.
 */
const parseAgentRunError = (err: unknown): ParsedRunError => {
    const raw =
        err instanceof Error ? err.message : typeof err === "string" ? err : String(err ?? "")
    const fallback = raw.trim() || "The agent run failed."
    try {
        const obj = JSON.parse(raw) as Record<string, unknown>
        const status = (obj?.status && typeof obj.status === "object" ? obj.status : obj) as Record<
            string,
            unknown
        >
        const message =
            typeof status?.message === "string"
                ? status.message
                : typeof obj?.message === "string"
                  ? (obj.message as string)
                  : null
        if (message) {
            return {message, code: typeof status?.code === "number" ? status.code : undefined}
        }
    } catch {
        // raw isn't JSON — it's already the human message.
    }
    return {message: fallback}
}

/** The last real content element in the log (the last turn's last child). Used to measure the REAL
 * content bottom and ignore the min-h-full reserve that pads a streaming turn — so the jump pill and
 * stick-to-bottom track the latest message, not the bottom of the empty reserved space. */
const lastContentEl = (el: HTMLElement): HTMLElement | null => {
    const wrappers = el.querySelectorAll<HTMLElement>("[data-mid]")
    const wrapper = wrappers[wrappers.length - 1]
    if (!wrapper) return null
    return (wrapper.lastElementChild as HTMLElement | null) ?? wrapper
}

/** True when the latest message content sits at or above the viewport bottom (i.e. fully visible). */
const atLiveEdge = (el: HTMLElement): boolean => {
    const last = lastContentEl(el)
    if (!last) return true
    return last.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom < 24
}

/**
 * One message row. Carries `data-mid` (load-bearing for the pin / anchor / ResizeObserver, which all
 * query it). A message added after mount (`enter`) fades in — OPACITY ONLY, deliberately: opacity
 * doesn't change geometry, so it can't move the scroll position or trip the SC-3 ResizeObserver. A
 * restored thread's messages render with `enter=false` (no cascade). Honors reduced-motion: the
 * initial transparency and the transition are both `motion-safe`, so it's instant-visible otherwise.
 */
const MessageRow = ({
    mid,
    enter,
    children,
    inspected = false,
    onInspect,
}: {
    mid: string
    enter: boolean
    children: React.ReactNode
    /** This turn is the Turn Inspector's current target — tint it. */
    inspected?: boolean
    /** Set (assistant turns, inspector open) → click the row to re-focus the inspector on it. */
    onInspect?: () => void
}) => {
    const [shown, setShown] = useState(!enter)
    // Reveal one frame after mount so the opacity transition plays. Deps are [] (NOT
    // [enter]) on purpose: an `enter` flip when a sibling turn arrives must not cancel
    // this rAF, or a just-sent message strands at opacity-0 for the whole agent run.
    useEffect(() => {
        const raf = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(raf)
    }, [])
    // Click-to-refocus: only while the inspector is open, and never over an interactive control or
    // an active text selection (so buttons, links, and copy-select still work).
    const handleClick = onInspect
        ? (e: React.MouseEvent) => {
              if ((e.target as HTMLElement).closest("button, a, input, textarea, [role='button']"))
                  return
              if (!window.getSelection()?.isCollapsed) return
              onInspect()
          }
        : undefined
    // While the inspector is open, a turn is interactive: padded + rounded so the fill has breathing
    // room. Inspected = a persistent, slightly stronger version of the hover fill (same visual
    // language, just "held"). `box-border` is required (preflight off → content-box) so the padding
    // doesn't overflow the 880px column.
    const interactive = Boolean(onInspect)
    // `shown || !enter` is a belt-and-suspenders: a settled row (id seen) is always visible.
    return (
        <div
            data-mid={mid}
            onClick={handleClick}
            className={`${CHAT_COLUMN} flex flex-col gap-1 motion-safe:transition-[opacity,background-color] motion-safe:duration-200 motion-safe:ease-out ${
                shown || !enter ? "opacity-100" : "motion-safe:opacity-0"
            } ${interactive ? "box-border rounded-lg px-3 py-2.5" : ""} ${
                inspected
                    ? "bg-[var(--ag-colorFillSecondary)]"
                    : interactive
                      ? "cursor-pointer hover:bg-[var(--ag-colorFillQuaternary)]"
                      : ""
            }`}
        >
            {children}
        </div>
    )
}

const AgentConversation = ({entityId, sessionId}: {entityId: string; sessionId: string}) => {
    const store = useStore()
    const persistMessages = useSetAtom(persistSessionMessagesAtom)
    const stampMessagesCreatedAt = useSetAtom(stampMessagesCreatedAtAtom)
    const switchEntity = useSetAtom(playgroundController.actions.switchEntity)
    const setSessionStatus = useSetAtom(setSessionStatusAtom)
    const openTurnInspector = useSetAtom(turnInspectorAtom)
    const inspectorTarget = useAtomValue(turnInspectorAtom)
    const buildMode = !useAtomValue(chatPanelMaximizedAtom)
    const inspectorOpen = inspectorTarget?.sessionId === sessionId
    // Leaving Build for Chat dismisses the inspector — it's a Build-mode tool, and the panel would
    // otherwise linger (and keep tinting a turn) in the maximized chat view.
    useEffect(() => {
        if (!buildMode && inspectorOpen) openTurnInspector(null)
    }, [buildMode, inspectorOpen, openTurnInspector])

    const [files, setFiles] = useState<UploadFile[]>([])
    // Files turned away by the guardrails (too big, wrong type, over the count), shown inline.
    const [rejections, setRejections] = useState<AttachmentRejection[]>([])
    const [attachmentsOpen, setAttachmentsOpen] = useState(false)
    // Single limits object so it can later be swapped for capability-derived limits.
    const limits = DEFAULT_ATTACHMENT_LIMITS
    const atMax = files.length >= limits.maxCount
    // Drag-over state for the whole-panel drop overlay (depth counter avoids child flicker).
    const dragDepthRef = useRef(0)
    const [isDragging, setIsDragging] = useState(false)
    // Whether the LAST assistant turn was user-stopped. You can only cancel the in-flight (last) turn,
    // so this is a single boolean gated on position at render time — independent of message ids (which
    // can be missing/duplicated in restore/error paths and would otherwise smear the tag onto every
    // turn). Cleared on the next send/resend.
    const [stopped, setStopped] = useState(false)
    // Seed once from the persisted store (read imperatively so our own writes don't feed back).
    const [initialMessages] = useState(() => store.get(sessionMessagesAtom)[sessionId] ?? [])
    // Ids already on screen — restored/settled turns don't re-animate; only turns added live fade in.
    const seenIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)))
    const {confirm, confirmDialog} = useConfirmDialog()

    const richInputRef = useRef<RichChatInputHandle>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    // Stick to the bottom of the scrollable area. This is the ONE source of truth for auto-scroll:
    // the active turn reserves a viewport (min-h-full), so "bottom" puts the latest question at the
    // top with the answer streaming into the space below — the pin is emergent, not computed. A real
    // user scroll-up releases it (onScroll); jump-to-latest re-arms it.
    const stickRef = useRef(true)
    const [showJump, setShowJump] = useState(false)
    // Arm a one-shot scroll to the bottom: on a fresh submit (glide) and on restoring a saved thread
    // (instant). Combined with min-h-full this is the whole SC-1/SC-2 positioning — no per-element pin.
    const armBottomRef = useRef(initialMessages.length > 0)
    const animateBottomRef = useRef(false)
    // Set while WE move the scroll (the bottom glide / SC-3 compensation). onScroll ignores the
    // resulting event so our own scroll isn't mistaken for the user reaching/leaving the live edge.
    const programmaticScrollRef = useRef(false)
    // Teardown for the in-flight smooth scroll (removes its listeners + fallback timer).
    const pinCleanupRef = useRef<(() => void) | null>(null)
    // Last observed scrollTop. A content shrink (tool gutter collapsing, reasoning folding) clamps
    // scrollTop to the new smaller bottom and fires a scroll event that isn't a user gesture; comparing
    // against this lets onScroll tell a real scroll-DOWN-to-edge from that clamp (which only decreases).
    const lastScrollTopRef = useRef(0)
    // rAF handle coalescing the jump-pill measurement (querySelectorAll + getBoundingClientRect) to once
    // per frame — a fast wheel/drag and every streamed render would otherwise re-measure a dirtied layout.
    const showJumpRafRef = useRef(0)

    // `useChat` pins its `Chat` (and thus this transport) for the life of the session `id`; it is
    // NOT recreated when `entityId` changes (only on an `id` change). So the request builder must
    // read the CURRENT entity through a ref — capturing `entityId` by value would send every turn
    // with the revision that was displayed when the session first mounted, even after a switch or a
    // self-commit. Reading `entityIdRef.current` at send time keeps runs on the live revision.
    const entityIdRef = useRef(entityId)
    entityIdRef.current = entityId

    // Turn Inspector capture write, read via ref so the transport `useMemo` doesn't depend on it.
    const captureTurnRequest = useSetAtom(captureTurnRequestAtom)
    const captureRef = useRef(captureTurnRequest)
    captureRef.current = captureTurnRequest

    // Transport feeds the v6 stream request from the playground pipeline. `api` here is a
    // placeholder that `prepareSendMessagesRequest` overrides per request.
    const transport = useMemo(
        () =>
            new AgentChatTransport({
                api: "",
                prepareSendMessagesRequest: async ({messages, id}) => {
                    const req = await buildAgentRequest(entityIdRef.current, messages, {
                        sessionId: id ?? sessionId,
                    })
                    if (!req) {
                        throw new Error(
                            "This agent workflow has no invocation URL — it can’t be run yet.",
                        )
                    }
                    captureRef.current(buildTurnCapture(req, generateId(), Date.now()))
                    return {api: req.invocationUrl, headers: req.headers, body: req.requestBody}
                },
            }),
        [sessionId],
    )

    const {
        messages,
        sendMessage,
        status,
        stop,
        regenerate,
        setMessages,
        addToolApprovalResponse,
        addToolOutput,
        error,
    } = useChat({
        id: sessionId,
        messages: initialMessages,
        transport,
        // Approve AND deny both resume — a deny-only decision must re-send so the runner
        // gets the denial round-trip and the model continues (no `approval-responded` limbo).
        sendAutomaticallyWhen: agentShouldResumeAfterApproval,
        onError: (err) => {
            // Render the error in-chat (the `error` alert below); swallow it here so an
            // aborted/errored stream doesn't bubble unhandled to the Next.js dev overlay (F-033).
            console.warn("[AgentChatPanel] useChat error (rendered in-chat):", err)
        },
    })

    const busy = status === "submitted" || status === "streaming"

    // Settle a parked client tool (#4920). The dispatcher calls this from a widget (e.g. the connect
    // widget) with the structured reference; `addToolOutput` matches the part by `toolCallId` on the
    // last turn and the resume predicate auto-resends. `tool` is only the typed-tools key — matching
    // is by id — so a cast onto the untyped UIMessage tool map is safe.
    const handleClientToolOutput = useCallback<ClientToolOutputHandler>(
        ({toolName, toolCallId, output, errorText}) => {
            if (errorText !== undefined) {
                addToolOutput({
                    state: "output-error",
                    tool: toolName as never,
                    toolCallId,
                    errorText,
                }).catch(ignoreStreamRejection)
            } else {
                addToolOutput({
                    tool: toolName as never,
                    toolCallId,
                    output: (output ?? {}) as never,
                }).catch(ignoreStreamRejection)
            }
        },
        [addToolOutput],
    )

    // ── "Run in playground" seam (producer: a trigger drawer's Run-in-playground) ──
    // A trigger fires server-side and never reaches the playground; this lets a user
    // channel a trigger's resolved inputs into the active session. Only the ACTIVE
    // session's conversation consumes the pending run (antd Tabs can keep inactive
    // panes mounted), sends it as a user turn, and clears it. A monotonic nonce lets
    // the same inputs run again; a ref guards double-firing. The consuming effect lives
    // below `useAgentChatQueue` so the run goes through the same `submit` path as a manual
    // send — respecting a pending HITL approval and any queued messages instead of jumping
    // ahead with a raw `sendMessage`.
    const scopeKey = useChatScopeKey()
    const activeSessionId = useAtomValue(activeSessionIdAtomFamily(scopeKey))
    const pendingRun = useAtomValue(simulatedAgentRunAtomFamily(entityId))
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId))
    const consumedRunNonceRef = useRef<number | null>(null)

    // `handleRewind` is passed to every memo'd `AgentMessage`, so it must stay referentially
    // stable — a streamed token must not recreate it and re-render the whole list. `messages`/
    // `busy` change every token, so read them through refs instead of capturing them.
    const messagesRef = useRef(messages)
    messagesRef.current = messages
    const busyRef = useRef(busy)
    busyRef.current = busy

    // Send one released queued message. Stable (only depends on `sendMessage`) so the queue's
    // release effect doesn't churn on every token.
    const sendQueued = useCallback(
        (item: QueuedMessage) => {
            stickRef.current = true
            setShowJump(false)
            // Any actual send supersedes a prior user-stop, so clear the marker here (covers the
            // queue-release path; the manual path also clears it in handleSubmit) — otherwise the
            // "Stopped" tag would smear onto the freshly-sent turn.
            setStopped(false)
            sendMessage(
                item.fileParts && item.fileParts.length
                    ? item.text
                        ? {text: item.text, files: item.fileParts}
                        : {files: item.fileParts}
                    : {text: item.text},
            ).catch(ignoreStreamRejection)
        },
        [sendMessage],
    )

    // Queue messages typed while a turn is streaming or paused on a HITL approval; released
    // one-by-one once the turn truly settles (never mid-approval). A user stop is the exception —
    // it voids the pending gate, so `stopped` lets a fresh send go immediately (not queue).
    const {queued, submit, removeQueued, clearQueue, hitlPending} = useAgentChatQueue({
        status,
        messages,
        stopped,
        sendQueued,
    })

    // Pending HITL gates for the paused turn, surfaced in the persistent ApprovalDock above the
    // composer (not inline in the transcript, so a paused run can't scroll out of reach). Trace
    // opens the paused turn's own trace drawer.
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const pendingApprovals = useMemo(() => getPendingApprovals(messages), [messages])
    const openPausedTurnTrace = useMemo(() => {
        const last = messages[messages.length - 1]
        const traceId = last ? getMessageTraceId(last) : undefined
        return traceId ? () => openTraceDrawer({traceId}) : undefined
    }, [messages, openTraceDrawer])

    // Publish this session's run state (single source of truth: drives the tab bar's status dot
    // AND the Session inspector's live-watcher signal, which derives "streaming" from `running`).
    // Precedence error > awaiting approval > running > idle. Reset to idle on unmount so a closed
    // tab keeps no stale dot and stops claiming it's the live watcher.
    useEffect(() => {
        const status: SessionRunStatus = error
            ? "error"
            : hitlPending
              ? "awaiting"
              : busy
                ? "running"
                : "idle"
        setSessionStatus({id: sessionId, status})
    }, [error, hitlPending, busy, sessionId, setSessionStatus])
    useEffect(
        () => () => setSessionStatus({id: sessionId, status: "idle"}),
        [sessionId, setSessionStatus],
    )

    // Consume a pending "Run in playground" request (declared above) via the queue's `submit`,
    // so it interleaves with HITL approval / queued messages exactly like a manual send.
    useEffect(() => {
        if (!pendingRun || activeSessionId !== sessionId) return
        // A new-session run is handled at the panel level first (it creates + activates a fresh
        // session and clears the flag); this per-session consumer ignores it until then.
        if (pendingRun.newSession) return
        if (consumedRunNonceRef.current === pendingRun.nonce) return
        consumedRunNonceRef.current = pendingRun.nonce
        stickRef.current = true
        setShowJump(false)
        submit({text: pendingRun.text})
        setPendingRun(null)
    }, [pendingRun, activeSessionId, sessionId, submit, setPendingRun])

    // Surface a stream failure inline: stamp the parsed error onto the failing assistant turn so
    // it renders as a red error bubble with the real reason (and persists with the session via the
    // effect below), instead of a transient top banner + a generic "no response". FE-only — it
    // uses the error useChat already has; the backend doesn't need to attach it to the trace.
    useEffect(() => {
        if (!error) return
        const parsed = parseAgentRunError(error)
        setMessages((prev) => {
            const last = prev.length > 0 ? prev[prev.length - 1] : undefined
            const existing = (last?.metadata as {runError?: {message?: string}} | undefined)
                ?.runError
            if (last?.role === "assistant") {
                if (existing?.message === parsed.message) return prev // already stamped
                const next = [...prev]
                next[next.length - 1] = {
                    ...last,
                    metadata: {...(last.metadata as object | undefined), runError: parsed},
                }
                return next
            }
            // No trailing assistant turn (failed before one existed) — add a minimal carrier.
            return [
                ...prev,
                {
                    id: `run-error-${generateId()}`,
                    role: "assistant",
                    parts: [],
                    metadata: {runError: parsed},
                } as (typeof prev)[number],
            ]
        })
    }, [error, setMessages])

    // Persist the conversation whenever its stream settles (skip mid-stream).
    useEffect(() => {
        if (status === "streaming") return
        persistMessages({id: sessionId, messages})
    }, [messages, status, sessionId, persistMessages])

    // Stamp a first-seen timestamp on any newly-appeared message (user + assistant).
    useEffect(() => {
        stampMessagesCreatedAt(messages.map((m) => m.id))
    }, [messages, stampMessagesCreatedAt])

    // ── #4920 Application 1: refresh the config on a committed revision ──
    // When the agent commits a new revision of itself, the backend emits a one-way
    // `data-committed-revision` part (same channel as `data-trace`), in BOTH the gated approval path
    // and the direct `needs_approval=false` path. On receipt we invalidate the latest-revision and
    // inspect caches so the config panel, section drawers, and build-kit view all re-read the new
    // config. Deduped by revision id so a re-render (token stream) doesn't re-invalidate.
    const committedRevisionsSeenRef = useRef<Set<string>>(new Set())
    useEffect(() => {
        for (const message of messages) {
            for (const part of message.parts) {
                if ((part as {type?: string}).type !== "data-committed-revision") continue
                const data = (part as {data?: {revisionId?: string; version?: string}}).data
                // A stable key per commit: prefer the revision id, fall back to the whole payload.
                const key = data?.revisionId ?? JSON.stringify(data ?? {}) ?? "committed"
                if (committedRevisionsSeenRef.current.has(key)) continue
                committedRevisionsSeenRef.current.add(key)
                invalidateAgentCommittedRevisionCache()
                if (data?.revisionId && data.revisionId !== entityId) {
                    switchEntity({currentEntityId: entityId, newEntityId: data.revisionId})
                }
            }
        }
    }, [messages, entityId, switchEntity])

    // ── DT3 cancelled state: wrap stop() to mark the in-flight assistant turn ──
    const markStopped = useCallback(() => {
        const last = messages[messages.length - 1]
        if (last && last.role === "assistant") setStopped(true)
    }, [messages])

    const handleStop = useCallback(() => {
        markStopped()
        stop()
    }, [markStopped, stop])

    // ── D9 teardown: abort the in-flight stream on unmount (tab close / revision swap) ──
    // Keyed on sessionId: closing a tab or swapping the revision unmounts this conversation
    // and should tear down its stream.
    useEffect(() => {
        return () => {
            stop()
        }
    }, [sessionId, stop])

    // ── SC-3: anchor-based scroll preservation ──
    // We do scroll-anchoring ourselves (Safari has no CSS overflow-anchor, and it would fight our
    // programmatic pins). While NOT following, remember the topmost visible message; when content above
    // it changes height (an image loads, markdown/code renders, a tool card expands), we compensate
    // scrollTop so that message stays on the same line. Growth BELOW the anchor (the streaming answer)
    // doesn't move it, so it's left alone.
    const anchorRef = useRef<{id: string; top: number} | null>(null)
    const recordAnchor = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const containerTop = el.getBoundingClientRect().top
        for (const w of el.querySelectorAll<HTMLElement>("[data-mid]")) {
            const r = w.getBoundingClientRect()
            // First message whose bottom is still below the viewport top = the topmost visible one.
            if (r.bottom > containerTop + 1) {
                anchorRef.current = {id: w.dataset.mid ?? "", top: r.top - containerTop}
                return
            }
        }
        anchorRef.current = null
    }, [])

    // ── DT4 autoscroll: stick to the bottom of the scrollable area while following ──
    // The fill (min-h-full turn group) makes "question at top" the scroll bottom for a short answer
    // and the answer's end the bottom for a long one, so scrollHeight is the right target (+ pb-6 gap).
    // Only writes when not already pinned: the ResizeObserver (below) and the follow effect both pin on
    // the same streamed growth, so the guard drops the redundant write (and the scroll event it fires).
    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const target = el.scrollHeight - el.clientHeight
        if (el.scrollTop < target - 0.5) el.scrollTop = target
    }, [])

    // Recompute jump-pill visibility, coalesced to one rAF per frame. The measurement (atLiveEdge →
    // querySelectorAll + getBoundingClientRect) is display-only, so a one-frame lag is invisible; the
    // correctness-critical follow decision (stickRef) and SC-3 anchor stay synchronous in onScroll.
    const scheduleShowJump = useCallback(() => {
        if (showJumpRafRef.current) return
        showJumpRafRef.current = requestAnimationFrame(() => {
            showJumpRafRef.current = 0
            const el = scrollRef.current
            if (!el) return
            setShowJump(!stickRef.current && !atLiveEdge(el))
        })
    }, [])

    // Smoothly scroll the log to `target` (the SC-1 pin / jump-to-latest). Uses the browser's NATIVE
    // smooth scroll so it runs on the compositor — smooth even while React re-renders streamed tokens,
    // and natively interruptible. The caller holds programmaticScrollRef across it so onScroll / the
    // ResizeObserver ignore the in-between frames; `scrollend` (or a fallback timeout) settles it. A
    // real user wheel/touch hands control straight back. Honors prefers-reduced-motion (instant).
    const animatePinTo = useCallback((el: HTMLDivElement, target: number, onSettle: () => void) => {
        pinCleanupRef.current?.()
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        if (reduce || Math.abs(target - el.scrollTop) < 2) {
            el.scrollTop = target
            onSettle()
            return
        }
        let done = false
        let timer = 0
        const cleanup = () => {
            el.removeEventListener("scrollend", onEnd)
            el.removeEventListener("wheel", onUser)
            el.removeEventListener("touchstart", onUser)
            if (timer) clearTimeout(timer)
            pinCleanupRef.current = null
        }
        // Reached the target (scrollend, or the fallback timer) → settle: recordAnchor + release guard.
        const onEnd = () => {
            if (done) return
            done = true
            cleanup()
            onSettle()
        }
        // User grabbed the scroll mid-glide → stop guarding so their scroll is honored; don't settle.
        const onUser = () => {
            if (done) return
            done = true
            cleanup()
            programmaticScrollRef.current = false
        }
        el.addEventListener("scrollend", onEnd)
        el.addEventListener("wheel", onUser, {passive: true})
        el.addEventListener("touchstart", onUser, {passive: true})
        timer = window.setTimeout(onEnd, 700) // fallback where scrollend is unsupported (older Safari)
        // Cancel without settling (a newer pin supersedes this one, or we unmount).
        pinCleanupRef.current = () => {
            done = true
            cleanup()
        }
        el.scrollTo({top: target, behavior: "smooth"})
    }, [])

    // Stop any in-flight pin animation on unmount (tab close / revision swap).
    useEffect(
        () => () => {
            pinCleanupRef.current?.()
            if (showJumpRafRef.current) cancelAnimationFrame(showJumpRafRef.current)
        },
        [],
    )

    // After each commit, mark on-screen messages as seen so they don't re-animate on later renders
    // (e.g. streaming tokens). Done in an effect, not during render, so StrictMode's double invoke
    // doesn't mark a brand-new message before its first paint and rob it of the fade.
    useEffect(() => {
        for (const m of messages) seenIdsRef.current.add(m.id)
    }, [messages])

    useEffect(() => {
        // Don't instant-jump while a programmatic glide (SC-1 submit / jump-to-latest) owns the
        // scroll — that snap would override the animation. The glide's own settle re-pins to bottom.
        if (stickRef.current && !programmaticScrollRef.current) scrollToBottom()
    }, [messages, status, scrollToBottom])

    const onScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        // Track scrollTop even for our own pins (recorded, then ignored) so the next real event has an
        // accurate baseline to compare against.
        const prevTop = lastScrollTopRef.current
        lastScrollTopRef.current = el.scrollTop
        // Ignore the scroll event our own pin produced — only a real user scroll changes follow state.
        if (programmaticScrollRef.current) return
        // Follow ONLY when at the very bottom of the scrollable area; a partial scroll must not enable
        // it (that was the yank). Re-arm follow ONLY when the user actively scrolls DOWN to the edge (or
        // is already following): a content shrink (tool gutter collapsing to "Used N tools", reasoning
        // folding) clamps scrollTop to the new smaller bottom and fires a scroll event, but a clamp only
        // ever DECREASES scrollTop, so `> prevTop` rejects it — otherwise the next token would snap the
        // min-h-full active turn to the top (reported as the chat "jumping to the top" mid-stream).
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        stickRef.current = atBottom && (stickRef.current || el.scrollTop > prevTop)
        // Anchor is correctness-critical for SC-3 (the RO reads it next resize) → capture synchronously.
        if (!stickRef.current) recordAnchor()
        // Pill is display-only → coalesce its costly measurement to one rAF/frame.
        scheduleShowJump()
    }, [recordAnchor, scheduleShowJump])

    const jumpToLatest = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        setShowJump(false)
        // Glide to the bottom like the SC-1 pin. Resume follow (stickRef) only ON SETTLE — flipping
        // it true now would let the per-token follow effect jam to the bottom mid-glide. The final
        // scrollToBottom catches any content that streamed in during the animation.
        programmaticScrollRef.current = true
        animatePinTo(el, el.scrollHeight, () => {
            el.scrollTop = el.scrollHeight
            stickRef.current = true
            programmaticScrollRef.current = false
        })
    }, [animatePinTo])

    // SC-3: when any message resizes (image load, markdown/code render, tool-card expand), hold the
    // reader's place. Following → keep pinned to the bottom; otherwise compensate scrollTop so the
    // anchored (topmost visible) message stays on the same line. Guarded so it never fights our own
    // pins. Re-subscribed when the message set changes (a part growing fires on the same wrapper).
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const onResize = () => {
            if (programmaticScrollRef.current) return
            if (stickRef.current) {
                scrollToBottom() // guarded: no-op if the follow effect already pinned this growth
                return
            }
            const a = anchorRef.current
            if (!a) return
            let node: HTMLElement | null = null
            try {
                node = el.querySelector<HTMLElement>(`[data-mid="${a.id}"]`)
            } catch {
                node = null
            }
            if (!node) return
            const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top
            // A stale anchor (its node scrolled far off after a programmatic jump / follow) yields an
            // implausible delta; applying it would slam the scroll to the top. Drop it and let the next
            // scroll / pointer-down re-anchor. A real collapse/expand moves the anchor well under a viewport.
            if (Math.abs(delta) > el.clientHeight) {
                anchorRef.current = null
                return
            }
            if (Math.abs(delta) > 0.5) {
                programmaticScrollRef.current = true
                el.scrollTop += delta
                requestAnimationFrame(() => {
                    programmaticScrollRef.current = false
                })
            }
        }
        const ro = new ResizeObserver(onResize)
        el.querySelectorAll("[data-mid]").forEach((w) => ro.observe(w))
        return () => ro.disconnect()
    }, [messages.length, scrollToBottom])

    // SC-1 (submit) / SC-2 (restore): scroll the log to the bottom, once, when armed. With the active
    // turn reserving a viewport (min-h-full + top padding to clear the fade), "bottom" shows the new
    // question pinned at the top and the answer streaming into the space below — no per-element pin to
    // compute, nothing to keep re-aligning as content arrives. A fresh submit glides; a restore jumps.
    // Follow (stickRef) resumes only ON SETTLE so the per-token follow effect can't jam mid-glide.
    useLayoutEffect(() => {
        if (!armBottomRef.current) return
        const el = scrollRef.current
        if (!el) return
        armBottomRef.current = false
        programmaticScrollRef.current = true
        const settle = () => {
            el.scrollTop = el.scrollHeight // catch anything that streamed in during the glide
            stickRef.current = true
            programmaticScrollRef.current = false
        }
        if (animateBottomRef.current) {
            animateBottomRef.current = false
            animatePinTo(el, el.scrollHeight, settle)
        } else {
            el.scrollTop = el.scrollHeight
            requestAnimationFrame(settle)
        }
    }, [messages, animatePinTo])

    // Keep the jump pill honest as content streams/settles: show it when the real latest message is
    // below the fold (e.g. a long answer growing past the viewport while parked at the top), and hide
    // it once that message is visible or while we're following. Coalesced (not a sync layout read per
    // streamed render) — the pill is display-only, so one frame of lag is imperceptible.
    useEffect(() => {
        scheduleShowJump()
    }, [messages, status, scheduleShowJump])

    // SC-4: interaction is intent, not just scrolling. While following, a real text selection inside
    // the transcript — or opening a link in it — means the reader is engaging here, so release follow
    // (exactly like a scroll). New content keeps arriving offscreen and the jump pill offers the way
    // back. Keyboard / wheel / touch already release because they scroll (onScroll). The composer is
    // exempt: its selections and links aren't inside the log, so `el.contains(...)` ignores them.
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const release = () => {
            if (!stickRef.current) return
            stickRef.current = false
            setShowJump(!atLiveEdge(el))
        }
        const onSelectionChange = () => {
            if (!stickRef.current) return
            const sel = window.getSelection()
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
            if (sel.anchorNode && el.contains(sel.anchorNode)) release()
        }
        const onClick = (e: MouseEvent) => {
            if ((e.target as HTMLElement | null)?.closest("a")) release()
        }
        document.addEventListener("selectionchange", onSelectionChange)
        el.addEventListener("click", onClick)
        return () => {
            document.removeEventListener("selectionchange", onSelectionChange)
            el.removeEventListener("click", onClick)
        }
    }, [])

    const toUploadFile = (file: File): UploadFile => ({
        uid: `${file.name}-${file.lastModified}-${file.size}`,
        name: file.name,
        status: "done",
        originFileObj: file as UploadFile["originFileObj"],
    })

    /** Add files from paste / programmatic sources through the guardrails. */
    const addFiles = (incoming: File[]) => {
        const {accepted, rejections: rej} = validateIncoming(incoming, files.length, limits)
        if (accepted.length) {
            setFiles((prev) => [...prev, ...accepted.map(toUploadFile)])
            setAttachmentsOpen(true)
        }
        setRejections(rej)
    }

    const removeFile = (uid: string) => setFiles((prev) => prev.filter((f) => f.uid !== uid))

    // Native drag-and-drop onto the whole panel. A depth counter ignores dragenter/leave from
    // nested children so the overlay doesn't flicker; only file drags (not text) are handled.
    const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files")
    const onDragEnter = (e: React.DragEvent) => {
        if (!isFileDrag(e)) return
        dragDepthRef.current += 1
        setIsDragging(true)
    }
    const onDragOver = (e: React.DragEvent) => {
        if (isFileDrag(e)) e.preventDefault()
    }
    const onDragLeave = (e: React.DragEvent) => {
        if (!isFileDrag(e)) return
        dragDepthRef.current -= 1
        if (dragDepthRef.current <= 0) {
            dragDepthRef.current = 0
            setIsDragging(false)
        }
    }
    const onDrop = (e: React.DragEvent) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        dragDepthRef.current = 0
        setIsDragging(false)
        const dropped = Array.from(e.dataTransfer.files)
        if (dropped.length) {
            addFiles(dropped)
            setAttachmentsOpen(true)
        }
    }

    const handleSubmit = async (text: string) => {
        const trimmed = text.trim()
        const fileObjs = files
            .map((f) => f.originFileObj as File | undefined)
            .filter((f): f is File => Boolean(f))
        if (!trimmed && fileObjs.length === 0) return
        const fileParts = fileObjs.length ? await filesToParts(fileObjs) : undefined
        // Glide to the bottom; the min-h-full active turn makes that show the new question at the top
        // with the answer streaming below. Park during the glide, follow again on settle. Clear any
        // prior "stopped" marker — it's resolved by asking again.
        stickRef.current = false
        armBottomRef.current = true
        animateBottomRef.current = true
        setShowJump(false)
        setStopped(false)
        // One path: `submit` sends now or queues behind held messages via the shared release gate.
        submit({text: trimmed, fileParts})
        setFiles([])
        setRejections([])
        setAttachmentsOpen(false)
    }

    const handleRewind = useCallback(
        (message: UIMessage) => {
            const msgs = messagesRef.current
            if (busyRef.current) return
            const idx = msgs.findIndex((m) => m.id === message.id)
            if (idx < 0) return
            const isUser = message.role === "user"
            const sideEffects = sideEffectingToolsInRange(msgs.slice(idx))

            const run = () => {
                if (isUser) {
                    setMessages(msgs.slice(0, idx))
                    richInputRef.current?.setMarkdown(messageText(message))
                    requestAnimationFrame(() => richInputRef.current?.focus())
                } else {
                    regenerate({messageId: message.id}).catch(ignoreStreamRejection)
                }
            }

            if (sideEffects.length > 0) {
                confirm({
                    title: "Rewind past a tool that already ran?",
                    content: `${sideEffects.join(", ")} already executed. Rewinding re-runs the conversation from here but will NOT undo it.`,
                    okText: "Rewind anyway",
                    okButtonProps: {danger: true},
                    cancelText: "Cancel",
                    centered: true,
                    style: {borderRadius: 16},
                    onOk: run,
                })
            } else {
                run()
            }
        },
        [confirm, regenerate, setMessages],
    )

    // Group the ACTIVE turn (the last user message + its response) into one wrapper that carries the
    // fill. Keeping the fill on a STABLE element — not hopping it from the user bubble to the assistant
    // bubble when the answer arrives — avoids the mid-stream layout jump.
    const lastUserIndex = (() => {
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i
        return -1
    })()
    const activeStart = lastUserIndex >= 0 ? lastUserIndex : messages.length
    // The fill = min-h-full on the active turn whenever there's PRIOR conversation above it (so the
    // question can sit at the top). Derived from layout, NOT from `busy` — so it persists when the turn
    // settles instead of being yanked away (which clamped the scroll and jumped the view).
    const reserveActive = activeStart > 0

    const renderMessage = (message: UIMessage, index: number) => {
        const isLast = index === messages.length - 1
        // New since mount → fade in once. Mark seen immediately so a re-render mid-stream (tokens
        // arriving) doesn't re-arm the animation; the row keeps its mounted state by key anyway.
        // Don't mutate seenIdsRef here — that runs during render (unsafe under StrictMode's double
        // invoke). Marking happens in an effect after commit.
        const enter = !seenIdsRef.current.has(message.id)
        // A user turn has no trace of its own; borrow the paired (next) assistant turn's trace so its
        // timestamp dates from the run, not this browser's first-seen stamp.
        const turnTraceId =
            message.role === "user" && messages[index + 1]
                ? getMessageTraceId(messages[index + 1])
                : undefined
        // While the inspector is open, an assistant turn tints when it's the target and is
        // click-to-refocus otherwise (click any other turn to re-point the inspector at it).
        const isAssistantTurn = message.role === "assistant"
        const isInspected =
            inspectorOpen && isAssistantTurn && message.id === inspectorTarget?.assistantMessageId
        const onInspect =
            inspectorOpen && isAssistantTurn
                ? () => openTurnInspector({sessionId, assistantMessageId: message.id})
                : undefined
        return (
            <MessageRow
                key={message.id}
                mid={message.id}
                enter={enter}
                inspected={isInspected}
                onInspect={onInspect}
            >
                <AgentMessage
                    message={message}
                    isStreaming={busy && isLast}
                    isLastMessage={isLast}
                    onRewind={() => handleRewind(message)}
                    onClientToolOutput={handleClientToolOutput}
                    precededByEmptyAssistant={
                        index > 0 && isEmptyAssistantTurn(messages[index - 1])
                    }
                    turnTraceId={turnTraceId}
                />
                {/* Waiting indicator stays inside the last message so the reserve keeps it on-screen. */}
                {isLast && status === "submitted" && message.role !== "assistant" && (
                    <Bubble placement="start" variant="borderless" loading content="" />
                )}
                {/* Stopped tag + Resend belong only to the LAST assistant turn (the one you cancelled),
                    gated on position so it can never smear onto past turns. Cleared on resend / ask. */}
                {stopped && isLast && message.role === "assistant" && (
                    <div className="flex items-center gap-2 self-start pl-1">
                        <Tag className="!m-0 !text-[11px]">Stopped</Tag>
                        <Button
                            className="!px-0 !text-xs"
                            disabled={busy}
                            onClick={() => {
                                setStopped(false)
                                regenerate({messageId: message.id}).catch(ignoreStreamRejection)
                            }}
                            variant="link"
                            size="sm"
                        >
                            Resend
                        </Button>
                    </div>
                )}
                {buildMode && message.role === "assistant" && (
                    <button
                        type="button"
                        onClick={() =>
                            openTurnInspector({sessionId, assistantMessageId: message.id})
                        }
                        className="flex w-fit cursor-pointer items-center gap-1 self-start rounded border-0 bg-transparent px-1 py-0.5 text-xs text-colorTextSecondary transition-colors hover:text-colorPrimary"
                    >
                        <TreeStructure size={12} />
                        Inspect turn
                    </button>
                )}
            </MessageRow>
        )
    }

    return (
        <div
            className="ag-canvas relative flex h-full min-h-0 w-full flex-row"
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {/* Themed confirm dialogs (rewind-past-a-tool) mount through this holder. */}
            {confirmDialog}
            {/* Chat column. The turn inspector is a flex sibling (below) so it pushes this column
                aside rather than overlaying it. */}
            <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3">
                {isDragging && (
                    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-colorPrimary bg-[var(--ant-color-primary-bg)]">
                        <UploadSimple size={26} className="text-colorPrimary" />
                        <span className="text-sm font-medium text-colorPrimary">
                            Drop files here
                        </span>
                        <span className="text-xs text-colorTextSecondary">
                            {limits.label} · up to {limits.maxCount},{" "}
                            {Math.round(limits.maxBytes / 1024 / 1024)} MB each
                        </span>
                    </div>
                )}
                {/* Stream errors are surfaced inline on the failing turn (red error bubble with the
                real reason), stamped in the effect above — no separate top-level banner. */}
                <div className="ag-canvas relative flex min-h-0 flex-1 flex-col">
                    <div
                        ref={(el) => {
                            scrollRef.current = el
                        }}
                        onScroll={onScroll}
                        // Capture a fresh SC-3 anchor before a click acts (expand/collapse a tool step,
                        // reasoning fold): those resize the transcript without a scroll, so onScroll never
                        // refreshes the anchor and the ResizeObserver would compensate against a stale one.
                        onPointerDownCapture={recordAnchor}
                        role="log"
                        aria-live="polite"
                        aria-label="Agent conversation"
                        // `pt-8` (32px) ≥ the 28px fade so the first message clears it at rest; `pb-6`
                        // + `[overflow-anchor:none]` are the SC scroll-engineering essentials (browser
                        // anchoring off so our pin/anchor logic owns the scroll position).
                        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 pt-8 pb-6 [overflow-anchor:none]"
                        // Fade content into the top edge (under the tab bar) and the bottom edge (into the
                        // composer) as it scrolls. A gradient mask on the scroll container: transparent at
                        // each edge → opaque across the middle. GPU-composited, no JS, theme-agnostic.
                        style={{
                            maskImage: EDGE_FADE_MASK,
                            WebkitMaskImage: EDGE_FADE_MASK,
                        }}
                    >
                        {messages.length === 0 && (
                            <AgentChatEmptyState entityId={entityId} onStart={handleSubmit} />
                        )}
                        {messages.slice(0, activeStart).map((m, i) => renderMessage(m, i))}
                        {activeStart < messages.length && (
                            // The active turn reserves a viewport (min-h-full) when there's prior
                            // conversation, so sticking to the bottom shows the question at the top with the
                            // answer streaming into the space below — the "pin" is this layout, not JS.
                            // `pt-8` keeps the question clear of the top fade once it reaches the top.
                            <div
                                className={`flex flex-col gap-3${reserveActive ? " min-h-full pt-8" : ""}`}
                            >
                                {messages
                                    .slice(activeStart)
                                    .map((m, i) => renderMessage(m, activeStart + i))}
                            </div>
                        )}
                    </div>

                    {/* Always mounted so it can fade + slide in/out; hidden state is non-interactive and
                    keeps `-translate-x-1/2` (Tailwind composes x/y translate on one transform). */}
                    <Button
                        onClick={jumpToLatest}
                        tabIndex={showJump ? 0 : -1}
                        aria-hidden={!showJump}
                        // Solid elevated surface + border + shadow so the pill reads clearly when it
                        // floats over streamed text (a transparent pill let the text bleed through).
                        className={[
                            `!absolute bottom-2 left-1/2 -translate-x-1/2 !border !border-solid !border-colorBorderSecondary !bg-colorBgElevated shadow-md transition-[opacity,transform] duration-200 ease-out ${
                                showJump
                                    ? "translate-y-0 opacity-100"
                                    : "pointer-events-none translate-y-3 opacity-0"
                            }`,
                            "rounded-full",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                        aria-label="Jump to latest message"
                        variant="outline"
                        size="sm"
                    >
                        {<ArrowDown size={14} />}
                        Jump to latest
                    </Button>
                </div>

                {/* Queue sits BETWEEN the messages and the composer, so showing it never shifts the
                composer (and the editor) upward. Streaming itself is signalled by the composer's
                send button (it becomes a spinning Stop button), so there's no "Streaming…" row. */}
                {queued.length > 0 && (
                    <div className={`${CHAT_COLUMN} flex items-center gap-2 px-3 pb-2`}>
                        <QueuedMessages
                            queued={queued}
                            onRemove={removeQueued}
                            onClear={clearQueue}
                        />
                    </div>
                )}

                {/* Rich markdown composer (Lexical). Enter sends; attachments via header/prefix slots.
                Wrapper `px-3` keeps the session-bar gutter; the input centers on CHAT_COLUMN so it
                aligns with the (also centered) message column when the panel is wide. The persistent
                HITL approval dock lives in this same block (above the input) — always mounted so it
                animates in/out, and inside the composer region so the paused gate can't scroll out
                of reach and its collapse adds no gap to the surrounding column. */}
                <div className="px-3">
                    <ApprovalDock
                        className={CHAT_COLUMN}
                        approvals={pendingApprovals}
                        onApprovalResponse={addToolApprovalResponse}
                        onViewTrace={openPausedTurnTrace}
                    />
                    <RichChatInput
                        ref={richInputRef}
                        className={`${CHAT_COLUMN} mb-3`}
                        onSubmit={handleSubmit}
                        placeholder="Ask the agent… (Enter to send, ⌘/Ctrl+Enter for newline)"
                        onPasteFile={(pasted) => addFiles(Array.from(pasted))}
                        sendForceEnabled={files.length > 0}
                        streaming={busy}
                        onStop={handleStop}
                        prefix={
                            // Attach button is gated until the agent service is ready for inline
                            // file parts (big-agents d4b119af26); paste / drag-to-add still work.
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            disabled={true}
                                            onClick={() => setAttachmentsOpen((open) => !open)}
                                            aria-label="Attach files"
                                            variant="ghost"
                                            size="icon"
                                        >
                                            {<Paperclip size={16} />}
                                        </Button>
                                    }
                                />
                                <TooltipContent>
                                    {atMax
                                        ? `Up to ${limits.maxCount} files`
                                        : "Attach files coming soon"}
                                </TooltipContent>
                            </Tooltip>
                        }
                        header={
                            <HeightCollapse open={attachmentsOpen || files.length > 0}>
                                <ComposerAttachments
                                    files={files}
                                    rejections={rejections}
                                    limits={limits}
                                    onAdd={addFiles}
                                    onRemove={removeFile}
                                    onDismissRejections={() => setRejections([])}
                                />
                            </HeightCollapse>
                        }
                    />
                </div>
            </div>
            <TurnInspector sessionId={sessionId} messages={messages} />
        </div>
    )
}

/**
 * AgentChatPanel — the agent-generation surface hosted INSIDE the playground (the third
 * generation arm beside chat and completion).
 *
 * Single view keeps the slice's session tab bar (design decision D2): parallel conversations,
 * add with `+`, close with `×`, double-click to rename — rendered as a row of status-dotted tags
 * (`SessionTagBar`) whose bottom edge aligns with the config panel header. Sessions are app-scoped
 * (shared with the rest of the playground) and persist to localStorage, so tabs survive a reload;
 * antd keeps visited panes mounted (we only swap the bar via `renderTabBar`), so switching tabs
 * preserves a session's live stream / approval state. Each tab is its own `useChat` driven by
 * `buildAgentRequest` against the current `entityId` (so the run always uses the live draft config).
 */
const AgentChatPanel = ({entityId}: {entityId: string}) => {
    const scope = useChatScopeKey()
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const addSession = useSetAtom(addSessionAtomFamily(scope))
    const closeSession = useSetAtom(closeSessionAtomFamily(scope))
    const renameSession = useSetAtom(renameSessionAtomFamily(scope))
    const setActiveSession = useSetAtom(setActiveSessionAtomFamily(scope))
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)

    // Always keep at least one tab. Re-arms when the list drains without double-firing
    // under StrictMode.
    const seeded = useRef(false)
    useEffect(() => {
        if (sessions.length === 0 && !seeded.current) {
            seeded.current = true
            addSession()
        }
        if (sessions.length > 0) seeded.current = false
    }, [sessions.length, addSession])

    // Tolerate a stale active id (its tab was closed) by falling back to the first tab.
    const activeId = sessions.some((s) => s.id === rawActiveId) ? rawActiveId : sessions[0]?.id

    // A trigger test asks for a fresh session: create + activate one, then clear the flag so the
    // new session's conversation consumes the turn (the per-session consumer skips flagged runs).
    const pendingRun = useAtomValue(simulatedAgentRunAtomFamily(entityId))
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId))
    const newSessionNonceRef = useRef<number | null>(null)
    useEffect(() => {
        if (!pendingRun?.newSession) return
        if (newSessionNonceRef.current === pendingRun.nonce) return
        newSessionNonceRef.current = pendingRun.nonce
        addSession()
        setPendingRun({text: pendingRun.text, nonce: pendingRun.nonce})
    }, [pendingRun, addSession, setPendingRun])

    return (
        <div className="flex h-full min-h-0 min-w-0 w-full flex-row">
            {/* Rail stays mounted and slides (width 0↔RAIL_WIDTH) so it animates in lockstep with the
                config pane instead of snapping. Clipped while collapsed; `inert` drops it from tab
                order + a11y when hidden. */}
            <div
                className="h-full shrink-0 overflow-hidden motion-safe:transition-[width] motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)]"
                style={{width: chatMaximized ? RAIL_WIDTH : 0}}
                inert={!chatMaximized}
            >
                <SessionRail activeId={activeId} className="h-full w-[248px]" />
            </div>
            <Tabs
                animated={false}
                className="flex min-h-0 min-w-0 flex-1 flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-tabpane]:h-full"
                activeKey={activeId}
                onChange={setActiveSession}
                renderTabBar={() => (
                    // Chat mode has no inline session controls (they live in the SessionRail), so the
                    // bar would be an empty 48px strip. Collapse its height to 0 — animated to match
                    // the rail/config panes — rather than leaving dead space or snapping it away.
                    <div
                        className="min-w-0 shrink-0 overflow-hidden motion-safe:transition-[height] motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)]"
                        style={{height: chatMaximized ? 0 : 48}}
                    >
                        <SessionTagBar
                            sessions={sessions}
                            activeId={activeId}
                            onSelect={setActiveSession}
                            onAdd={addSession}
                            onClose={closeSession}
                            onRename={(id, title) => renameSession({id, title})}
                            showSessions={!chatMaximized}
                            extra={
                                chatMaximized ? undefined : (
                                    <>
                                        <SessionInspectorButton sessionId={activeId ?? null} />
                                        <SessionHistoryMenu />
                                    </>
                                )
                            }
                        />
                    </div>
                )}
                items={sessions.map((session) => ({
                    key: session.id,
                    // Bar is rendered by `renderTabBar` (SessionTagBar); the per-item label is unused.
                    label: null,
                    children: <AgentConversation entityId={entityId} sessionId={session.id} />,
                }))}
            />
        </div>
    )
}

export default AgentChatPanel
