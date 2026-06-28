import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react"

import {agentShouldResumeAfterApproval, buildAgentRequest} from "@agenta/playground"
import {generateId} from "@agenta/shared/utils"
import {useChat} from "@ai-sdk/react"
import {Bubble, Sender} from "@ant-design/x"
import {ArrowDown, Paperclip, UploadSimple} from "@phosphor-icons/react"
import {type UIMessage} from "ai"
import {Button, Modal, Tabs, Tag, Tooltip} from "antd"
import type {UploadFile} from "antd"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {AgentChatTransport} from "./assets/AgentChatTransport"
import {
    type AttachmentRejection,
    DEFAULT_ATTACHMENT_LIMITS,
    validateIncoming,
} from "./assets/attachments"
import {filesToParts} from "./assets/files"
import {messageText, sideEffectingToolsInRange} from "./assets/rewind"
import AgentMessage from "./components/AgentMessage"
import ComposerAttachments from "./components/ComposerAttachments"
import SessionHistoryMenu from "./components/SessionHistoryMenu"
import SessionTabLabel from "./components/SessionTabLabel"
import {useChatScopeKey} from "./state/scope"
import {
    type AgentChatSession,
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    closeSessionAtomFamily,
    persistSessionMessagesAtom,
    renameSessionAtomFamily,
    sessionFirstUserTextAtomFamily,
    sessionMessagesAtom,
    sessionsListAtomFamily,
    setActiveSessionAtomFamily,
} from "./state/sessions"

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
const ignoreStreamRejection = () => {}

/** Height of the top-edge fade, in px. Shared by the CSS mask and the SC-1 pin so a pinned turn
 * lands BELOW the fade (otherwise the freshly-asked question renders partially faded). */
const TOP_FADE_PX = 28
/** Top-edge fade for the message scroll area: transparent at the very top, fully opaque by
 * TOP_FADE_PX. Applied as a CSS mask so the content itself fades (correct in any theme). */
const TOP_FADE_MASK = `linear-gradient(to bottom, transparent 0, #000 ${TOP_FADE_PX}px)`

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
}: {
    mid: string
    enter: boolean
    children: React.ReactNode
}) => {
    const [shown, setShown] = useState(!enter)
    useEffect(() => {
        if (!enter) return
        const raf = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(raf)
    }, [enter])
    return (
        <div
            data-mid={mid}
            className={`flex flex-col gap-1 motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out ${
                shown ? "opacity-100" : "motion-safe:opacity-0"
            }`}
        >
            {children}
        </div>
    )
}

const AgentConversation = ({entityId, sessionId}: {entityId: string; sessionId: string}) => {
    const store = useStore()
    const persistMessages = useSetAtom(persistSessionMessagesAtom)

    const [input, setInput] = useState("")
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

    const senderRef = useRef<React.ComponentRef<typeof Sender>>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    // SC-2: a restored thread opens parked (not following) at the last user message; a brand-new empty
    // session follows the bottom as the first answer streams.
    const stickRef = useRef(initialMessages.length === 0)
    const [showJump, setShowJump] = useState(false)
    // Arm a one-shot scroll that pins a user message to the top once it has mounted. Used both for a
    // freshly-submitted turn (SC-1) and, when a saved thread is restored, for its last user message
    // (SC-2) — both resolve "the last user message" the same way in the pin effect below.
    const armPinRef = useRef(initialMessages.some((m) => m.role === "user"))
    // Set while we move the scroll position ourselves (the SC-1 pin). onScroll ignores the resulting
    // event so a programmatic pin isn't mistaken for the user reaching the live edge (which would flip
    // stick-to-bottom on and jam the view back down, undoing the pin).
    const programmaticScrollRef = useRef(false)
    // rAF handle for the smooth pin animation, and whether the NEXT pin should animate. A fresh
    // submit (SC-1) animates so the question glides to the top; a thread restore / tab switch
    // (SC-2) jumps — you want to open already-positioned, not watch it scroll.
    const pinAnimRef = useRef<number | null>(null)
    const animatePinRef = useRef(false)

    // Transport feeds the v6 stream request from the playground pipeline. `api` here is a
    // placeholder that `prepareSendMessagesRequest` overrides per request.
    const transport = useMemo(
        () =>
            new AgentChatTransport({
                api: "",
                prepareSendMessagesRequest: async ({messages, id}) => {
                    const req = await buildAgentRequest(entityId, messages, {
                        sessionId: id ?? sessionId,
                    })
                    if (!req) {
                        throw new Error(
                            "This agent workflow has no invocation URL — it can’t be run yet.",
                        )
                    }
                    return {api: req.invocationUrl, headers: req.headers, body: req.requestBody}
                },
            }),
        [entityId, sessionId],
    )

    const {
        messages,
        sendMessage,
        status,
        stop,
        regenerate,
        setMessages,
        addToolApprovalResponse,
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
    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [])

    // Smoothly scroll the log to `target` (the SC-1 pin). programmaticScrollRef stays set for the
    // whole animation so onScroll / the ResizeObserver ignore the intermediate frames; a real user
    // wheel/touch cancels it and hands control back. Honors prefers-reduced-motion (instant).
    const animatePinTo = useCallback((el: HTMLDivElement, target: number, onSettle: () => void) => {
        if (pinAnimRef.current != null) cancelAnimationFrame(pinAnimRef.current)
        const start = el.scrollTop
        const dist = target - start
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        if (reduce || Math.abs(dist) < 2) {
            el.scrollTop = target
            onSettle()
            return
        }
        const cancel = () => {
            if (pinAnimRef.current != null) cancelAnimationFrame(pinAnimRef.current)
            pinAnimRef.current = null
            el.removeEventListener("wheel", cancel)
            el.removeEventListener("touchstart", cancel)
            // Hand control back: clear the guard so the user's scroll is honored by onScroll.
            programmaticScrollRef.current = false
        }
        const finish = () => {
            pinAnimRef.current = null
            el.removeEventListener("wheel", cancel)
            el.removeEventListener("touchstart", cancel)
            onSettle()
        }
        el.addEventListener("wheel", cancel, {passive: true})
        el.addEventListener("touchstart", cancel, {passive: true})
        const ease = (t: number) => 1 - Math.pow(1 - t, 3) // easeOutCubic — quick out, soft land
        const dur = 280
        let startTs: number | null = null
        const step = (ts: number) => {
            if (startTs == null) startTs = ts
            const t = Math.min(1, (ts - startTs) / dur)
            el.scrollTop = start + dist * ease(t)
            if (t < 1) pinAnimRef.current = requestAnimationFrame(step)
            else finish()
        }
        pinAnimRef.current = requestAnimationFrame(step)
    }, [])

    // Stop any in-flight pin animation on unmount (tab close / revision swap).
    useEffect(
        () => () => {
            if (pinAnimRef.current != null) cancelAnimationFrame(pinAnimRef.current)
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
        if (stickRef.current) scrollToBottom()
    }, [messages, status, scrollToBottom])

    const onScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        // Ignore the scroll event our own pin produced — only a real user scroll changes follow state.
        if (programmaticScrollRef.current) return
        // Follow ONLY when at the very bottom of the scrollable area; a partial scroll must not enable
        // it (that was the yank). The jump pill instead tracks whether the real latest message is in view.
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        setShowJump(!atLiveEdge(el))
        // Remember where the reader is parked so SC-3 can hold it through layout changes above.
        if (!stickRef.current) recordAnchor()
    }, [recordAnchor])

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
                el.scrollTop = el.scrollHeight
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
    }, [messages.length])

    // Pin the last user message to the top of the viewport, one time, when armed: on a fresh submit
    // (SC-1, so the answer streams into the fill below) and on restoring a saved thread (SC-2, so it
    // reopens at the last meaningful turn rather than the absolute bottom).
    useLayoutEffect(() => {
        if (!armPinRef.current) return
        const el = scrollRef.current
        if (!el) return
        const lastUser = [...messages].reverse().find((m) => m.role === "user")
        if (!lastUser) return
        let node: HTMLElement | null = null
        try {
            node = el.querySelector<HTMLElement>(`[data-mid="${lastUser.id}"]`)
        } catch {
            node = null
        }
        if (!node) return
        armPinRef.current = false
        programmaticScrollRef.current = true
        const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
        // Land the pinned message below the top fade (+4px breathing room) so it isn't dimmed.
        const target = Math.max(0, top - TOP_FADE_PX - 4)
        const settle = () => {
            // SC-3: anchor the pinned position so a late image/markdown load above doesn't push it down.
            recordAnchor()
            programmaticScrollRef.current = false
        }
        if (animatePinRef.current) {
            animatePinRef.current = false
            animatePinTo(el, target, settle)
        } else {
            el.scrollTop = target
            requestAnimationFrame(settle)
        }
    }, [messages, recordAnchor, animatePinTo])

    // Keep the jump pill honest as content streams/settles: show it when the real latest message is
    // below the fold (e.g. a long answer growing past the viewport while parked at the top), and hide
    // it once that message is visible or while we're following.
    useLayoutEffect(() => {
        const el = scrollRef.current
        if (el) setShowJump(!stickRef.current && !atLiveEdge(el))
    }, [messages, status])

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
        if ((!trimmed && fileObjs.length === 0) || busy) return
        const fileParts = fileObjs.length ? await filesToParts(fileObjs) : undefined
        // SC-1: pin the new turn to the top; the answer streams into the space below it. We park the
        // view (not following) and clear any prior "stopped" marker — it's resolved by asking again.
        // animatePinRef → the pin glides (a fresh submit), vs the instant jump used on thread restore.
        stickRef.current = false
        armPinRef.current = true
        animatePinRef.current = true
        setShowJump(false)
        setStopped(false)
        // Swallow the rejection — a stream error/abort is already surfaced via `onError` and
        // the in-chat `error` alert; without this it bubbles to the Next.js dev overlay (F-033).
        sendMessage(
            fileParts
                ? trimmed
                    ? {text: trimmed, files: fileParts}
                    : {files: fileParts}
                : {text: trimmed},
        ).catch(ignoreStreamRejection)
        setInput("")
        setFiles([])
        setRejections([])
        setAttachmentsOpen(false)
    }

    const handleRewind = (message: UIMessage) => {
        if (busy) return
        const idx = messages.findIndex((m) => m.id === message.id)
        if (idx < 0) return
        const isUser = message.role === "user"
        const sideEffects = sideEffectingToolsInRange(messages.slice(idx))

        const run = () => {
            if (isUser) {
                setMessages(messages.slice(0, idx))
                setInput(messageText(message))
                requestAnimationFrame(() => senderRef.current?.focus())
            } else {
                regenerate({messageId: message.id}).catch(ignoreStreamRejection)
            }
        }

        if (sideEffects.length > 0) {
            Modal.confirm({
                title: "Rewind past a tool that already ran?",
                content: `${sideEffects.join(", ")} already executed. Rewinding re-runs the conversation from here but will NOT undo it.`,
                okText: "Rewind anyway",
                okButtonProps: {danger: true},
                cancelText: "Cancel",
                onOk: run,
            })
        } else {
            run()
        }
    }

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
        return (
            <MessageRow key={message.id} mid={message.id} enter={enter}>
                <AgentMessage
                    message={message}
                    isStreaming={busy && isLast}
                    onRewind={() => handleRewind(message)}
                    onApprovalResponse={addToolApprovalResponse}
                    precededByEmptyAssistant={
                        index > 0 && isEmptyAssistantTurn(messages[index - 1])
                    }
                />
                {/* Waiting indicator stays inside the last message so the reserve keeps it on-screen. */}
                {isLast && status === "submitted" && message.role !== "assistant" && (
                    <Bubble placement="start" variant="outlined" loading content="" />
                )}
                {/* Stopped tag + Resend belong only to the LAST assistant turn (the one you cancelled),
                    gated on position so it can never smear onto past turns. Cleared on resend / ask. */}
                {stopped && isLast && message.role === "assistant" && (
                    <div className="flex items-center gap-2 self-start pl-1">
                        <Tag className="!m-0 !text-[11px]">Stopped</Tag>
                        <Button
                            type="link"
                            size="small"
                            className="!px-0 !text-xs"
                            disabled={busy}
                            onClick={() => {
                                setStopped(false)
                                regenerate({messageId: message.id}).catch(ignoreStreamRejection)
                            }}
                        >
                            Resend
                        </Button>
                    </div>
                )}
            </MessageRow>
        )
    }

    return (
        <div
            className="relative flex h-full min-h-0 w-full flex-col gap-3"
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {isDragging && (
                <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-colorPrimary bg-[var(--ant-color-primary-bg)]">
                    <UploadSimple size={26} className="text-colorPrimary" />
                    <span className="text-sm font-medium text-colorPrimary">Drop files here</span>
                    <span className="text-xs text-colorTextSecondary">
                        {limits.label} · up to {limits.maxCount},{" "}
                        {Math.round(limits.maxBytes / 1024 / 1024)} MB each
                    </span>
                </div>
            )}
            {/* Stream errors are surfaced inline on the failing turn (red error bubble with the
                real reason), stamped in the effect above — no separate top-level banner. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                    ref={(el) => {
                        scrollRef.current = el
                    }}
                    onScroll={onScroll}
                    role="log"
                    aria-live="polite"
                    aria-label="Agent conversation"
                    // `pt-8` (32px) ≥ the 28px fade so the first message clears it at rest; `pb-6`
                    // + `[overflow-anchor:none]` are the SC scroll-engineering essentials (browser
                    // anchoring off so our pin/anchor logic owns the scroll position).
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 pt-8 pb-6 [overflow-anchor:none]"
                    // Fade content into the top edge (under the tab bar) as it scrolls up. A
                    // gradient mask on the scroll container: transparent at the very top → opaque
                    // by 28px → opaque the rest of the way. GPU-composited, no JS, theme-agnostic.
                    style={{
                        maskImage: TOP_FADE_MASK,
                        WebkitMaskImage: TOP_FADE_MASK,
                    }}
                >
                    {messages.length === 0 && (
                        <div className="m-auto text-center text-xs text-colorTextTertiary">
                            Ask a question to start the agent conversation.
                        </div>
                    )}
                    {messages.slice(0, activeStart).map((m, i) => renderMessage(m, i))}
                    {activeStart < messages.length && (
                        // SC-1: the active turn reserves a viewport (min-h-full) while streaming with
                        // prior conversation above, so the question pins to the top and the answer
                        // lands below it. One stable wrapper for the whole turn → no mid-stream jump.
                        <div className={`flex flex-col gap-3${reserveActive ? " min-h-full" : ""}`}>
                            {messages
                                .slice(activeStart)
                                .map((m, i) => renderMessage(m, activeStart + i))}
                        </div>
                    )}
                </div>

                {showJump && (
                    <Button
                        size="small"
                        shape="round"
                        icon={<ArrowDown size={14} />}
                        onClick={jumpToLatest}
                        // Solid elevated surface + border + shadow so the pill reads clearly when it
                        // floats over streamed text (a transparent pill let the text bleed through).
                        className="!absolute bottom-2 left-1/2 -translate-x-1/2 !border !border-solid !border-colorBorderSecondary !bg-colorBgElevated shadow-md"
                        aria-label="Jump to latest message"
                    >
                        Jump to latest
                    </Button>
                )}
            </div>

            {/* Neutralize antd X Sender's header chrome: `.ant-sender-header-header` ships a
                tinted (`colorFillAlter`) + top-rounded box that reads as a second border inside
                the composer; flatten it and drop the header-content's double padding so our
                attachment panel sits flush on the composer surface. */}
            <div className="[&_.ant-sender-header-content]:!p-0 [&_.ant-sender-header-header]:!rounded-none [&_.ant-sender-header-header]:!bg-transparent">
                <Sender
                    ref={senderRef}
                    value={input}
                    onChange={setInput}
                    loading={busy}
                    onSubmit={handleSubmit}
                    onCancel={handleStop}
                    onPasteFile={(pasted) => addFiles(Array.from(pasted))}
                    prefix={
                        <Tooltip title={atMax ? `Up to ${limits.maxCount} files` : "Attach files"}>
                            <Button
                                type="text"
                                size="small"
                                icon={<Paperclip size={16} />}
                                disabled={atMax}
                                onClick={() => setAttachmentsOpen((open) => !open)}
                                aria-label="Attach files"
                            />
                        </Tooltip>
                    }
                    header={
                        <div
                            className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
                                attachmentsOpen || files.length > 0
                                    ? "grid-rows-[1fr] opacity-100"
                                    : "grid-rows-[0fr] opacity-0"
                            }`}
                        >
                            <div className="min-h-0 overflow-hidden">
                                <ComposerAttachments
                                    files={files}
                                    rejections={rejections}
                                    limits={limits}
                                    onAdd={addFiles}
                                    onRemove={removeFile}
                                    onDismissRejections={() => setRejections([])}
                                />
                            </div>
                        </div>
                    }
                    placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"
                />
            </div>
        </div>
    )
}

/**
 * AgentChatPanel — the agent-generation surface hosted INSIDE the playground (the third
 * generation arm beside chat and completion).
 *
 * Single view keeps the slice's editable-card session tab bar (design decision D2): parallel
 * conversations, add with `+`, close with `×`, double-click to rename. Sessions are app-scoped
 * (shared with the rest of the playground) and persist to localStorage, so tabs survive a
 * reload; antd keeps visited panes mounted, so switching tabs preserves a session's live
 * stream / approval state. Each tab is its own `useChat` driven by `buildAgentRequest` against
 * the current `entityId` (so the run always uses the live draft config).
 */
/**
 * Tab label, scoped to its own session: subscribes only to that session's first-user-text
 * (a stable string), so a streaming conversation doesn't re-render the whole tab bar / every
 * mounted pane on each token.
 */
const TabLabel = ({
    session,
    index,
    onRename,
}: {
    session: AgentChatSession
    index: number
    onRename: (title: string) => void
}) => {
    const text = useAtomValue(sessionFirstUserTextAtomFamily(session.id))
    const truncated = text.length > 24 ? `${text.slice(0, 24)}…` : text
    return (
        <SessionTabLabel
            label={session.title || truncated || `Chat ${index + 1}`}
            onRename={onRename}
        />
    )
}

const AgentChatPanel = ({entityId}: {entityId: string}) => {
    const scope = useChatScopeKey()
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const addSession = useSetAtom(addSessionAtomFamily(scope))
    const closeSession = useSetAtom(closeSessionAtomFamily(scope))
    const renameSession = useSetAtom(renameSessionAtomFamily(scope))
    const setActiveSession = useSetAtom(setActiveSessionAtomFamily(scope))

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

    return (
        <div className="flex h-full min-h-0 w-full flex-col p-3">
            <Tabs
                type="editable-card"
                size="small"
                className="flex min-h-0 flex-1 flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-nav]:!mb-0 [&_.ant-tabs-nav]:!-mx-3 [&_.ant-tabs-nav]:!px-3 [&_.ant-tabs-tabpane]:h-full"
                activeKey={activeId}
                onChange={setActiveSession}
                onEdit={(targetKey, action) => {
                    if (action === "add") addSession()
                    else if (typeof targetKey === "string") closeSession(targetKey)
                }}
                tabBarExtraContent={{right: <SessionHistoryMenu />}}
                items={sessions.map((session, index) => ({
                    key: session.id,
                    closable: sessions.length > 1,
                    label: (
                        <TabLabel
                            session={session}
                            index={index}
                            onRename={(title) => renameSession({id: session.id, title})}
                        />
                    ),
                    children: <AgentConversation entityId={entityId} sessionId={session.id} />,
                }))}
            />
        </div>
    )
}

export default AgentChatPanel
