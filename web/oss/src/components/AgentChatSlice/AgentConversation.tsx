import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type MutableRefObject,
} from "react"

import {revalidateSessionMountsAtom} from "@agenta/entities/session"
import {markTraceAsFresh} from "@agenta/entities/trace"

import {ContextRail} from "@/oss/components/Drives/ContextRail"
import {DriveSessionProvider} from "@/oss/components/Drives/driveSessionContext"
import {DriveQuickLook} from "@/oss/components/Drives/quickLook"
import {
    invalidateAgentCommittedRevisionCache,
    workflowBuildKitOverlayReadyAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {
    agentShouldResumeAfterApproval,
    buildAgentRequest,
    buildTurnCapture,
    playgroundController,
} from "@agenta/playground"
import {agentSelfCommitSignalAtom, simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {generateId} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useChat} from "@ai-sdk/react"
import {Bubble} from "@ant-design/x"
import {
    ArrowDown,
    ArrowRight,
    Code,
    Paperclip,
    Terminal,
    TreeStructure,
    UploadSimple,
} from "@phosphor-icons/react"
import {type UIMessage} from "ai"
import {App, Button, Modal, Tag, Tooltip} from "antd"
import type {UploadFile} from "antd"
import {useAtom, useAtomValue, useSetAtom, useStore} from "jotai"
import {useRouter} from "next/router"
import {Virtuoso, type Components, type VirtuosoHandle} from "react-virtuoso"

import {
    IDE_INSTALL_COMMAND,
    TEMPLATE_STRIP_MODE,
} from "@/oss/components/pages/agent-home/assets/constants"
import {
    captureFirstAgentIntent,
    classifyAgentIntent,
    truncateForCapture,
} from "@/oss/components/pages/agent-home/assets/onboardingAnalytics"
import {type AgentTemplate} from "@/oss/components/pages/agent-home/assets/templates"
import OnboardingBrowseTemplates from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingBrowseTemplates"
import {useOptionalOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"
import Reveal from "@/oss/components/pages/agent-home/PlaygroundOnboarding/Reveal"
import {openTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import TemplateStrip from "@/oss/components/TemplateStrip"
import {buildCodingAgentClipboard} from "@/oss/components/TemplateStrip/assets/codingAgentClipboard"
import {STRIP_COPY} from "@/oss/components/TemplateStrip/assets/constants"
import CopiedToast from "@/oss/components/TemplateStrip/components/CopiedToast"
import {useTemplateProvenance} from "@/oss/components/TemplateStrip/hooks/useTemplateProvenance"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {AgentChatTransport} from "./assets/AgentChatTransport"
import {
    type AttachmentRejection,
    DEFAULT_ATTACHMENT_LIMITS,
    validateIncoming,
} from "./assets/attachments"
import {filesToParts} from "./assets/files"
import {loadSessionMessages} from "./assets/loadSession"
import {messageText, sideEffectingToolsInRange} from "./assets/rewind"
import {getMessageTraceId} from "./assets/trace"
import {useFileActivityDetector} from "./hooks/useFileActivityDetector"
import AgentChatEmptyState from "./components/AgentChatEmptyState"
import {ComposerSkeleton, TranscriptSkeleton} from "./components/AgentChatSkeleton"
import AgentMessage from "./components/AgentMessage"
import ApprovalDock, {getPendingApprovals} from "./components/ApprovalDock"
import type {ClientToolOutputHandler} from "./components/clientTools"
import ComposerAttachments from "./components/ComposerAttachments"
import ConnectModelBanner from "./components/ConnectModelBanner"
import QueuedMessages from "./components/QueuedMessages"
import RevealCollapse from "./components/RevealCollapse"
import RightPanel from "./components/RightPanel/RightPanel"
import RightPanelSplit from "./components/RightPanel/RightPanelSplit"
import {useAgentChatQueue, type QueuedMessage} from "./hooks/useAgentChatQueue"
import {useAgentModelKeyStatus} from "./hooks/useAgentModelKeyStatus"
import {expandedKeysForMessages, pruneExpandedAtom} from "./state/expandState"
import {agentFirstRunSeedAtom} from "./state/firstRunSeed"
import {chatPanelMaximizedAtom} from "./state/panelLayout"
import {rightPanelAtom} from "./state/rightPanel"
import {useChatScopeKey} from "./state/scope"
import {
    attachmentsBySession,
    clearSessionFresh,
    composerDraftBySession,
    isSessionFresh,
    virtStateBySession,
} from "./state/sessionEphemera"
import {
    type SessionRunStatus,
    activeSessionIdAtomFamily,
    persistSessionMessagesAtom,
    sessionMessagesAtom,
    setSessionStatusAtom,
    stampMessagesCreatedAtAtom,
} from "./state/sessions"
import {captureTurnRequestAtom} from "./state/turnCaptures"
import {
    agentChatItemEstimateAtom,
    agentChatOverscanAtom,
    agentChatVirtualizeAtom,
    isAgentChatVirtualizationAvailable,
} from "./state/virtualization"

// The composer carries Lexical — the heaviest dependency of this chunk — out of the
// conversation's synchronous mount; React.lazy (not next/dynamic) so the imperative handle
// ref forwards. Its fallback is the same ComposerSkeleton the frame reserves for this slot.
const RichChatInput = lazy(() =>
    import("@agenta/ui/rich-chat-input").then((m) => ({default: m.RichChatInput})),
)

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

/** Single source of truth for the (currently DISABLED) content-visibility optimization. Disabled in
 * 5f0fa73d06 — it caused a scrollbar-shrink on first scroll-through — but the mechanism is kept so it
 * can be re-enabled with a fix. Gates BOTH the CSS class and the SC-3 intrinsic-size measurement, so
 * while off neither the styling nor the measurement runs. Typed `boolean` so the guards aren't
 * flagged as always-false. Under Virtuoso it must stay off regardless (it corrupts item measurement). */
const CONTENT_VISIBILITY_ENABLED = false as boolean

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

/** A part the transcript actually renders — non-empty text/reasoning, files, sources, tools. */
const isVisiblePart = (p: UIMessage["parts"][number]): boolean =>
    (p.type === "text" && Boolean((p as {text?: string}).text?.trim())) ||
    (p.type === "reasoning" && Boolean((p as {text?: string}).text?.trim())) ||
    p.type === "file" ||
    p.type === "source-url" ||
    p.type.startsWith("tool-") ||
    p.type === "dynamic-tool"

/** A settled assistant turn with no content at all — no answer, reasoning, tool, file, or
 * source part. Mirrors AgentMessage's `!hasContent`; used to collapse a run of "no response"
 * bubbles (e.g. repeated failed runs) down to the first one. */
const isEmptyAssistantTurn = (m: UIMessage): boolean =>
    m.role === "assistant" && !m.parts.some(isVisiblePart)

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

/** SPIKE(virtuoso): context passed to the Virtuoso Header/Footer slots (top padding + active turn). */
interface VirtCtx {
    header: React.ReactNode
    footer: React.ReactNode
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
    offscreenSkip = false,
}: {
    mid: string
    enter: boolean
    children: React.ReactNode
    /** This turn is the Turn Inspector's current target — tint it. */
    inspected?: boolean
    /** Set (assistant turns, inspector open) → click the row to re-focus the inspector on it. */
    onInspect?: () => void
    /** Settled row → `content-visibility:auto` so the browser skips its layout/paint while off-screen.
     * `contain-intrinsic-size: auto` remembers the real height after first paint, so leaving the
     * viewport causes no layout shift (heights here range ~85–1022px; no fixed estimate works). */
    offscreenSkip?: boolean
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
                offscreenSkip ? "[content-visibility:auto] [contain-intrinsic-size:auto_240px]" : ""
            } ${shown || !enter ? "opacity-100" : "motion-safe:opacity-0"} ${
                interactive ? "box-border rounded-lg px-3 py-2.5" : ""
            } ${
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

/** Compact three-dot pulse for the meta row under the last turn — the run-in-progress signal.
 * Deliberately NOT a Bubble: it shares one line with "Inspect turn" instead of adding a
 * bubble-sized row of its own. */
const WorkingDots = () => (
    <span
        role="status"
        aria-label="Agent is working"
        className="flex items-center gap-1 px-1 py-0.5"
    >
        <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-colorTextTertiary [animation-duration:1.2s]" />
        <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-colorTextTertiary [animation-delay:0.2s] [animation-duration:1.2s]" />
        <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-colorTextTertiary [animation-delay:0.4s] [animation-duration:1.2s]" />
    </span>
)

const AgentConversation = ({
    entityId,
    sessionId,
    revealPlayedRef,
}: {
    entityId: string
    sessionId: string
    /** Shared across the panel's session panes: the composer entrance plays only once. */
    revealPlayedRef: MutableRefObject<boolean>
}) => {
    const store = useStore()
    const persistMessages = useSetAtom(persistSessionMessagesAtom)
    const stampMessagesCreatedAt = useSetAtom(stampMessagesCreatedAtAtom)
    const switchEntity = useSetAtom(playgroundController.actions.switchEntity)
    const setSessionStatus = useSetAtom(setSessionStatusAtom)
    const [rightPanel, setRightPanel] = useAtom(rightPanelAtom)
    const buildMode = !useAtomValue(chatPanelMaximizedAtom)
    const rightPanelOpen = rightPanel?.sessionId === sessionId
    const turnInspectorOpen = rightPanelOpen && rightPanel?.mode === "turn"
    // The assistant turn the panel is inspecting (turn mode only), else null.
    const inspectedTurnId =
        rightPanel?.mode === "turn" && rightPanel.sessionId === sessionId
            ? rightPanel.assistantMessageId
            : null
    // Leaving Build for Chat dismisses the TURN view — it's a Build-mode tool that would otherwise
    // linger (and keep tinting a turn). The session view stays: it's valid in chat mode too.
    useEffect(() => {
        if (!buildMode && turnInspectorOpen) setRightPanel(null)
    }, [buildMode, turnInspectorOpen, setRightPanel])

    // Restored from the per-session store on remount (route re-entry, tab close/reopen) —
    // pending attachments survive alongside the composer draft. Rejections stay transient.
    const [files, setFiles] = useState<UploadFile[]>(
        () => attachmentsBySession.get(sessionId) ?? [],
    )
    useEffect(() => {
        if (files.length > 0) attachmentsBySession.set(sessionId, files)
        else attachmentsBySession.delete(sessionId)
    }, [files, sessionId])
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
    // Immutable snapshot of the restored ids (seenIdsRef grows) — the first-seen stamping
    // effect below skips these so a reload can't masquerade as the turns' send time.
    const restoredIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)))
    // Themed confirm dialogs. The static `Modal.confirm` renders detached from the app's
    // ConfigProvider, so it loses the theme (white box in dark mode). The hook form's
    // `contextHolder` is rendered in-tree, so its dialogs inherit the theme — same look as the
    // declarative EnhancedModal (centered, 16px radius).
    const [modal, modalContextHolder] = Modal.useModal()

    const richInputRef = useRef<RichChatInputHandle>(null)

    // Composer entrance plays once per PANEL mount — additional session panes mount the
    // composer fully shown (the replayed fade read as a "composer reload" on session switch).
    // Frozen at mount: recomputing per render would flip Reveal's `enabled` mid-entrance
    // (the latch effect below runs before the fade completes).
    const [playComposerEntrance] = useState(() => !revealPlayedRef.current)
    useEffect(() => {
        revealPlayedRef.current = true
    }, [revealPlayedRef])

    // Per-session unsent draft: restore once at mount (initialMarkdown is mount-only) and
    // capture edits debounced — markdown is read from the handle at capture time, not per
    // keystroke (serialization isn't free).
    const [initialDraft] = useState(() => composerDraftBySession.get(sessionId))
    const draftTimerRef = useRef(0)
    const handleComposerChange = useCallback(
        (text: string) => {
            window.clearTimeout(draftTimerRef.current)
            draftTimerRef.current = window.setTimeout(() => {
                const md = richInputRef.current?.getMarkdown() ?? text
                if (md.trim()) composerDraftBySession.set(sessionId, md)
                else composerDraftBySession.delete(sessionId)
            }, 400)
        },
        [sessionId],
    )
    useEffect(
        () => () => {
            window.clearTimeout(draftTimerRef.current)
            // Best-effort final capture on unmount (guarded — the editor may be detached).
            const md = richInputRef.current?.getMarkdown()
            if (md !== undefined) {
                if (md.trim()) composerDraftBySession.set(sessionId, md)
                else composerDraftBySession.delete(sessionId)
            }
        },
        [sessionId],
    )
    const scrollRef = useRef<HTMLDivElement>(null)
    // ── SPIKE(react-virtuoso): windowing variant, evaluated against content-visibility. ──
    // Controlled live from the playground settings dropdown (Virtualization section). When on, the
    // SC-1..4 scroll effects below are disabled (Virtuoso owns measurement/anchoring) and the
    // transcript renders via <Virtuoso>; overscan / row-estimate are tunable there too.
    // Virtualize only when the env flag is present AND it's enabled in the settings — no other gates.
    const virtEnabledInSettings = useAtomValue(agentChatVirtualizeAtom)
    const useVirtuoso = isAgentChatVirtualizationAvailable() && virtEnabledInSettings
    const virtOverscan = useAtomValue(agentChatOverscanAtom)
    const virtItemEstimate = useAtomValue(agentChatItemEstimateAtom)
    const virtuosoRef = useRef<VirtuosoHandle>(null)
    // Snapshot captured by a previous mount of this session (route re-entry). Read once at
    // mount — `restoreStateFrom` is a mount-time-only Virtuoso prop.
    const [virtRestoreState] = useState(() =>
        useVirtuoso ? virtStateBySession.get(sessionId) : undefined,
    )
    const router = useRouter()
    useEffect(() => {
        if (!useVirtuoso) return
        const capture = () => {
            // getState is synchronous; guard the handle for the unmount-cleanup path.
            virtuosoRef.current?.getState((snapshot) => {
                virtStateBySession.set(sessionId, snapshot)
            })
        }
        // routeChangeStart fires while the transcript is still mounted and measured — the
        // reliable capture point. The cleanup capture is best-effort (the handle may already
        // be detached there), covering non-route unmounts like a revision-type swap.
        router.events.on("routeChangeStart", capture)
        return () => {
            router.events.off("routeChangeStart", capture)
            capture()
        }
    }, [useVirtuoso, sessionId, router])
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

    const revalidateSessionMounts = useSetAtom(revalidateSessionMountsAtom)

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
        // Coalesce stream deltas to ~1 UI commit / 50ms so a fast token stream doesn't drive a
        // render per token; caps commit frequency independently of the per-commit memo win.
        experimental_throttle: 50,
        // Approve AND deny both resume — a deny-only decision must re-send so the runner
        // gets the denial round-trip and the model continues (no `approval-responded` limbo).
        sendAutomaticallyWhen: agentShouldResumeAfterApproval,
        // The turn's trace may not be ingested yet when the row asks for its summary —
        // marking it fresh lets the trace queries retry through the ingestion lag
        // (historical traces get no such grace; a 404 there means the trace is gone).
        // A finished turn may also have written files: mark the session's drive data stale so
        // every mount surface (open or opened later) refetches — no live channel exists for this.
        onFinish: ({message}) => {
            markTraceAsFresh(getMessageTraceId(message))
            revalidateSessionMounts(sessionId)
        },
        onError: (err) => {
            // Render the error in-chat (the `error` alert below); swallow it here so an
            // aborted/errored stream doesn't bubble unhandled to the Next.js dev overlay (F-033).
            console.warn("[AgentChatPanel] useChat error (rendered in-chat):", err)
        },
    })

    const busy = status === "submitted" || status === "streaming"

    // Mid-stream drive signals: settled write-ish tool calls append file-activity entries (and
    // throttle-revalidate the drives) as the turn streams, not just at onFinish.
    useFileActivityDetector({sessionId, messages})

    // Quick Look host: in-thread file cards and Files-tab tiles request a path via the atom;
    // this resolves it against THIS conversation's drive and renders the centered preview.
    const quickLookHost = <DriveQuickLook sessionId={sessionId} />

    // Build→Chat sequencing for the context rail: the mode switch eases the config pane out
    // (~240ms + hold, MainLayout `animateSplit`); the rail waits that ease out before sliding
    // in, so the transcript has ONE moving edge at a time instead of being squeezed from both.
    const [railHeldByModeSwitch, setRailHeldByModeSwitch] = useState(false)
    const prevBuildModeRef = useRef(buildMode)
    useEffect(() => {
        if (prevBuildModeRef.current === buildMode) return
        prevBuildModeRef.current = buildMode
        if (buildMode) {
            setRailHeldByModeSwitch(false)
            return
        }
        setRailHeldByModeSwitch(true)
        const timer = setTimeout(() => setRailHeldByModeSwitch(false), 300)
        return () => clearTimeout(timer)
    }, [buildMode])

    // Hybrid history: localStorage holds only the session INDEX; the durable conversation CONTENT
    // lives in the backend record log. Cache-first — when this tab opens with no locally-cached
    // messages (a session this browser never ran, or after a storage clear), hydrate once from the
    // server (`queryRecords` → v6 messages) and seed. Locally-cached sessions skip the fetch, so no
    // regression for own runs.
    // A to-be-hydrated session (empty local cache, not brand-new) shows a transcript skeleton
    // instead of the "start a chat" hero, so a session WITH server history doesn't flash the empty
    // state before its records land. Seeded synchronously so the first paint is already the skeleton.
    const hydratedRef = useRef(false)
    const [isHydrating, setIsHydrating] = useState(
        () => initialMessages.length === 0 && !isSessionFresh(sessionId),
    )
    useEffect(() => {
        // A session created brand-new in this browser and not yet run has no backend records —
        // skip the guaranteed-empty query (cleared on first send; after a reload it re-hydrates).
        if (hydratedRef.current || initialMessages.length > 0 || isSessionFresh(sessionId)) {
            setIsHydrating(false)
            return
        }
        hydratedRef.current = true
        let cancelled = false
        loadSessionMessages(sessionId)
            .then((msgs) => {
                if (cancelled || !msgs || msgs.length === 0) return
                // Restored history renders settled (no live fade-in) and pinned to the bottom.
                msgs.forEach((m) => {
                    seenIdsRef.current.add(m.id)
                    restoredIdsRef.current.add(m.id)
                })
                armBottomRef.current = true
                setMessages(msgs)
                persistMessages({id: sessionId, messages: msgs})
            })
            .finally(() => {
                if (!cancelled) setIsHydrating(false)
            })
        return () => {
            cancelled = true
        }
        // Seed once per mounted session tab; `sessionId` is stable for this instance.
    }, [sessionId])

    // True once the user settles a gate (approval response / client-tool output) in THIS mount —
    // i.e. the SDK's auto-resume genuinely is imminent, so the queue's pre-resume hold applies.
    // Without a live interaction, a tail that READS as "resume imminent" is an orphan restored
    // from storage (reload / remount killed the run mid-resume): nothing will ever fire that
    // resume, and holding for it froze the composer forever (AGE-3937).
    const liveGateInteractionRef = useRef(false)

    // Settle a parked client tool (#4920). The dispatcher calls this from a widget (e.g. the connect
    // widget) with the structured reference; `addToolOutput` matches the part by `toolCallId` on the
    // last turn and the resume predicate auto-resends. `tool` is only the typed-tools key — matching
    // is by id — so a cast onto the untyped UIMessage tool map is safe.
    const handleClientToolOutput = useCallback<ClientToolOutputHandler>(
        ({toolName, toolCallId, output, errorText}) => {
            liveGateInteractionRef.current = true
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

    // Model connection: is the project vault empty (no key of any kind), the agent not self-managed,
    // and the user never set up a key before? Drives the connect-a-model banner AND disables the
    // composer until connected — see `gateActive` on `useAgentModelKeyStatus` for the full chain.
    const modelKey = useAgentModelKeyStatus(entityId)
    const modelBlocked = modelKey.gateActive

    // ── Playground-native onboarding ──────────────────────────────────────────
    // This chat panel IS the onboarding surface while the agent is ephemeral: the empty state shows the
    // "what do you want to build?" hero and the composer renders Create-agent / Continue-in-IDE controls
    // (submit = commit the ephemeral in place, not send). Read from the OnboardingContext, present ONLY
    // inside the onboarding playground — null everywhere else, so every other chat usage is unchanged.
    const onboarding = useOptionalOnboardingContext()
    const onboardingActive = !!onboarding && !onboarding.realEntityId
    // Post-commit chrome (the connect-model banner) stays hidden through the commit + first send, then
    // eases in a beat later (see `chromeRevealed`) so it doesn't move the composer during the send.
    const chromeHidden = !!onboarding && !onboarding.chromeRevealed
    const onboardingPosthog = usePostHogAg()
    const {message: appMessage} = App.useApp()

    // ── Template strip (TEMPLATE_STRIP_MODE) ─────────────────────────────────
    // One provenance instance per panel, shared by the onboarding hero strip (S5) and the
    // agent empty-chat strip (S6): pick fills the composer + docks the chip above it.
    const stripProvenance = useTemplateProvenance({
        composerApi: {
            setText: (text) => richInputRef.current?.setMarkdown(text),
            getText: () => richInputRef.current?.getMarkdown() ?? "",
        },
    })
    // Provenance is scoped to ONE agent revision. `AgentConversation` survives an `entityId`
    // change in place (see the self-commit `switchEntity` above and a revision swap) — without
    // this, a template picked against the old entity would leak its name into the new one.
    useEffect(() => {
        stripProvenance.clear()
    }, [entityId, stripProvenance.clear])
    // S6 gate: fresh agent only (`version` v0/v1 = creation, same seed-vs-history convention used
    // elsewhere); unknown while loading counts as not-fresh so the strip never flashes in.
    const revisionQuery = useAtomValue(workflowMolecule.selectors.query(entityId))
    const revisionVersion = revisionQuery.data?.version
    const isFreshAgentRevision =
        !revisionQuery.isPending && typeof revisionVersion === "number" && revisionVersion <= 1
    const [copiedToastOpen, setCopiedToastOpen] = useState(false)
    const handleStripPick = useCallback(
        (template: AgentTemplate) => {
            stripProvenance.pick(template)
            captureFirstAgentIntent(onboardingPosthog, {
                source: "template",
                properties: {
                    template: template.name,
                    templateId: template.key,
                    templateCategory: template.category,
                    mode: "strip",
                    surface: onboardingActive ? "onboarding" : "agent-chat",
                },
                intentValue: template.category || template.name,
            })
        },
        [stripProvenance.pick, onboardingPosthog, onboardingActive],
    )
    const handleCodingAgentCopy = useCallback(async () => {
        const text = richInputRef.current?.getMarkdown().trim() ?? ""
        try {
            await navigator.clipboard.writeText(buildCodingAgentClipboard(text))
            setCopiedToastOpen(true)
        } catch {
            appMessage.error("Couldn't copy — copy it manually")
            return
        }
        captureFirstAgentIntent(onboardingPosthog, {
            source: "composer",
            properties: {action: "coding_agent_copy", message: truncateForCapture(text)},
        })
    }, [appMessage, onboardingPosthog])

    // Optimistic first turn: the description the user submitted with "Create agent", shown as a sent
    // user message + assistant loading placeholder DURING commit + until the real conversation takes
    // over — so the onboarding hero never flashes back and the switch reads as one continuous chat.
    const [pendingFirstTurn, setPendingFirstTurn] = useState<string | null>(null)

    const handleCreateAgent = useCallback(() => {
        if (!onboarding || onboarding.committing) return
        const text = richInputRef.current?.getMarkdown().trim() ?? ""
        // Resolve BEFORE clearing the composer below — `resolveTemplateName` compares against the
        // live text, so reading it after the clear would always see "" and never match the seed.
        const templateName = stripProvenance.resolveTemplateName(text)
        setPendingFirstTurn(text || null)
        // The text becomes the sent first turn — clear the composer so it doesn't linger into the chat.
        richInputRef.current?.setMarkdown("")
        // Free-text submit (never a template — those go straight through `onboarding.commit` from the
        // template pickers below, source "template"), so no double-fire with those call sites.
        if (text) {
            captureFirstAgentIntent(onboardingPosthog, {
                source: "composer",
                properties: {message: truncateForCapture(text)},
                intentValue: classifyAgentIntent(text),
            })
        }
        onboarding.commit(text, templateName)
        if (TEMPLATE_STRIP_MODE) stripProvenance.clear()
    }, [onboarding, onboardingPosthog, stripProvenance.clear, stripProvenance.resolveTemplateName])

    // Also cover the template-click commit path (which goes straight through `commit()`, not the
    // Create button): whenever a commit is in flight, show its seed as the optimistic turn and clear
    // any lingering composer text (e.g. a "Try" chip the user had prefilled).
    useEffect(() => {
        if (onboarding?.committing && onboarding.committingSeed) {
            setPendingFirstTurn(onboarding.committingSeed)
            richInputRef.current?.setMarkdown("")
        }
    }, [onboarding?.committing, onboarding?.committingSeed])

    // Once the real conversation has a message (auto-send fired post-commit), the placeholder handed
    // off — drop it so the real turn owns the view.
    useEffect(() => {
        if (messages.length > 0 && pendingFirstTurn) setPendingFirstTurn(null)
    }, [messages.length, pendingFirstTurn])

    // Commit failed (committing went true→false without producing a real agent): restore the hero so
    // the user can retry, rather than stranding the placeholder with an eternal spinner.
    const sawCommittingRef = useRef(false)
    useEffect(() => {
        if (onboarding?.committing) {
            sawCommittingRef.current = true
        } else if (sawCommittingRef.current && !onboarding?.realEntityId && messages.length === 0) {
            sawCommittingRef.current = false
            setPendingFirstTurn(null)
        }
    }, [onboarding?.committing, onboarding?.realEntityId, messages.length])

    const pendingFirstMessage = useMemo<UIMessage>(
        () => ({
            id: "pending-first-turn",
            role: "user",
            parts: [{type: "text", text: pendingFirstTurn ?? ""}],
        }),
        [pendingFirstTurn],
    )

    // "Continue in IDE" — the user's prompt lands as a real user turn, and a streamed-looking assistant
    // bubble hands off the install command + prompt (a pseudo response; there's no agent to run
    // pre-commit). Two clear steps: install the skill, then give the coding agent the prompt — the prompt
    // is NOT inside the shell block (it's not a command). Clears the composer so the text isn't duplicated.
    // Holds the pending IDE-bubble typewriter timer so it can be cancelled on unmount (tab close,
    // rewind, route change) — otherwise the recursive chain keeps calling setMessages on a stale closure.
    const ideBubbleTimerRef = useRef<number | null>(null)
    const streamIdeBubble = useCallback(() => {
        const prompt = richInputRef.current?.getMarkdown().trim() ?? ""
        const promptQuote = prompt
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        const full = prompt
            ? `Prefer to build in your IDE? Install the Agenta skill for Claude Code, Cursor, or any coding agent:\n\n\`\`\`bash\n${IDE_INSTALL_COMMAND}\n\`\`\`\n\nThen hand it your prompt:\n\n${promptQuote}`
            : `Prefer to build in your IDE? Install the Agenta skill for Claude Code, Cursor, or any coding agent:\n\n\`\`\`bash\n${IDE_INSTALL_COMMAND}\n\`\`\`\n\nThen describe the agent you want it to build.`
        const id = `ide-${generateId()}`
        const userId = `ide-user-${generateId()}`
        stickRef.current = false
        armBottomRef.current = true
        animateBottomRef.current = true
        setShowJump(false)
        setStopped(false)
        // Clear the composer — the prompt is now the sent user turn (and the editor is disabled after this).
        richInputRef.current?.setMarkdown("")
        setMessages(
            (prev) =>
                [
                    ...prev,
                    ...(prompt
                        ? [{id: userId, role: "user", parts: [{type: "text", text: prompt}]}]
                        : []),
                    {id, role: "assistant", parts: [{type: "text", text: ""}]},
                ] as typeof prev,
        )
        let shown = 0
        const chunk = Math.max(3, Math.ceil(full.length / 36))
        const tick = () => {
            shown = Math.min(full.length, shown + chunk)
            const text = full.slice(0, shown)
            setMessages(
                (prev) =>
                    prev.map((m) =>
                        m.id === id ? {...m, parts: [{type: "text", text}]} : m,
                    ) as typeof prev,
            )
            if (shown < full.length) ideBubbleTimerRef.current = window.setTimeout(tick, 28)
        }
        ideBubbleTimerRef.current = window.setTimeout(tick, 120)
    }, [setMessages])

    // Cancel any in-flight IDE-bubble animation on unmount so its timer chain can't fire post-unmount.
    useEffect(
        () => () => {
            if (ideBubbleTimerRef.current) window.clearTimeout(ideBubbleTimerRef.current)
        },
        [],
    )

    // After an IDE hand-off (onboarding + messages exist but nothing was committed), the chat is a
    // dead-end — there's no agent to talk to. Disable the composer and offer a single "Start over".
    const ideHandoffActive = onboardingActive && messages.length > 0
    const handleStartOver = useCallback(() => {
        setMessages([])
        richInputRef.current?.setMarkdown("")
    }, [setMessages])

    // First-run seed: a freshly-created agent (from Home's composer/template) surfaces its starting
    // prompt in the empty state (see AgentChatEmptyState) rather than pre-filling the composer, so it
    // reads as "here's what we'll do" not stray user input. Consumed once by the active session on a
    // fresh conversation, matching either the revision or app id, then cleared.
    const [firstRunSeed, setFirstRunSeed] = useAtom(agentFirstRunSeedAtom)
    const [firstRunPrompt, setFirstRunPrompt] = useState<string | null>(null)
    // An explicit-"go" seed (the onboarding Create-agent click) sends as soon as the model is ready.
    const [firstRunAutoSend, setFirstRunAutoSend] = useState(false)
    const seedConsumedRef = useRef(false)
    useEffect(() => {
        if (seedConsumedRef.current || !firstRunSeed) return
        if (entityId !== firstRunSeed.revisionId && entityId !== firstRunSeed.appId) return
        if (activeSessionId !== sessionId || messages.length > 0) return
        seedConsumedRef.current = true
        setFirstRunPrompt(firstRunSeed.seedMessage)
        setFirstRunAutoSend(!!firstRunSeed.autoSend)
        setFirstRunSeed(null)
    }, [firstRunSeed, entityId, activeSessionId, sessionId, messages.length, setFirstRunSeed])
    const consumedRunNonceRef = useRef<number | null>(null)

    // `handleRewind` is passed to every memo'd `AgentMessage`, so it must stay referentially
    // stable — a streamed token must not recreate it and re-render the whole list. `messages`/
    // `busy` change every token, so read them through refs instead of capturing them.
    const messagesRef = useRef(messages)
    messagesRef.current = messages
    const busyRef = useRef(busy)
    busyRef.current = busy

    // SWR revalidate-on-open: a cached session paints instantly from localStorage; in the background
    // we refetch the durable records ONCE (low-priority) and adopt the server transcript ONLY IF it's
    // strictly ahead of what we're showing (a turn finished on another device). We never clobber a
    // transcript that's live (`busyRef`), or that the server isn't strictly ahead of — so a local
    // optimistic/unsent tail is safe. Cache-MISS sessions are hydrated by the effect above; fresh
    // never-run sessions have no server records. Reconciliation is by message COUNT, not content:
    // detecting a same-length server-side edit/regenerate is deferred, as is focus/interval
    // revalidation. FOLLOWUP(sessions,swr): see docs/designs/sessions/frontend-integration.md.
    const revalidatedRef = useRef(false)
    useEffect(() => {
        if (revalidatedRef.current || initialMessages.length === 0 || isSessionFresh(sessionId))
            return
        revalidatedRef.current = true
        let cancelled = false
        loadSessionMessages(sessionId).then((serverMsgs) => {
            if (cancelled || !serverMsgs || serverMsgs.length === 0) return
            const prev = messagesRef.current
            if (busyRef.current || serverMsgs.length <= prev.length) return
            serverMsgs.forEach((m) => {
                seenIdsRef.current.add(m.id)
                restoredIdsRef.current.add(m.id)
            })
            armBottomRef.current = true
            setMessages(serverMsgs)
            persistMessages({id: sessionId, messages: serverMsgs})
        })
        return () => {
            cancelled = true
        }
        // Once per mounted session tab; `sessionId` is stable for this instance.
    }, [sessionId])

    // Send one released queued message. Stable (only depends on `sendMessage`) so the queue's
    // release effect doesn't churn on every token.
    const sendQueued = useCallback(
        (item: QueuedMessage) => {
            stickRef.current = true
            setShowJump(false)
            // A real send means this session has run — drop the never-run marker so a later
            // cache-cleared reopen hydrates from the server.
            clearSessionFresh(sessionId)
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
        [sendMessage, sessionId],
    )

    // Orphan detection for the queue's pre-resume hold: the tail is a RESTORED message (this
    // mount never streamed it) shaped like "auto-resume imminent", and no gate was settled live
    // in this mount. The SDK only evaluates `sendAutomaticallyWhen` on live events (approval
    // response, tool output, stream finish) — never on mount — so this resume can't fire and
    // must not hold the queue. Short-circuits cheap on the streaming hot path: any live send
    // makes the tail non-restored.
    const lastMessage = messages[messages.length - 1]
    const resumeOrphaned =
        !liveGateInteractionRef.current &&
        !!lastMessage &&
        restoredIdsRef.current.has(lastMessage.id) &&
        agentShouldResumeAfterApproval({messages})

    // Queue messages typed while a turn is streaming or paused on a HITL approval; released
    // one-by-one once the turn truly settles (never mid-approval). A user stop is the exception —
    // it voids the pending gate, so `stopped` lets a fresh send go immediately (not queue). An
    // orphaned restored resume shape (reload mid-approval-resume) voids it the same way.
    const {queued, submit, removeQueued, clearQueue, hitlPending} = useAgentChatQueue({
        status,
        messages,
        stopped,
        resumeOrphaned,
        sendQueued,
        sessionId,
    })

    // Approval responses flow through here (not bare `addToolApprovalResponse`) so a decision made
    // in THIS mount marks the resume as live — a restored approval-requested tail the user answers
    // after a reload genuinely auto-resumes, so the queue's pre-resume hold must apply to it.
    const handleApprovalResponse = useCallback(
        (args: {id: string; approved: boolean}) => {
            liveGateInteractionRef.current = true
            addToolApprovalResponse(args)
        },
        [addToolApprovalResponse],
    )

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

    // Bound the in-message expand-state store: on settle, drop entries whose owning message is gone
    // (rewound / evicted / closed). Live = every open session's persisted messages ∪ this active one.
    // `store.get` reads without subscribing, so this never adds re-renders on the streaming hot path.
    const pruneExpanded = useSetAtom(pruneExpandedAtom)
    useEffect(() => {
        if (status === "streaming") return
        const persisted = store.get(sessionMessagesAtom)
        const live = new Set<string>()
        for (const sid in persisted)
            for (const key of expandedKeysForMessages(persisted[sid])) live.add(key)
        for (const key of expandedKeysForMessages(messages)) live.add(key)
        pruneExpanded(live)
    }, [messages, status, store, pruneExpanded])

    // Stamp a first-seen timestamp on any newly-appeared LIVE message (user + assistant).
    // Restored rows are excluded: their first-seen is the reload moment, not the turn's time —
    // stamping them made old turns read "just now" until (or forever if) the trace never loads.
    // Unstamped, their timestamp slot shows a pending placeholder, then the trace's real time.
    useEffect(() => {
        stampMessagesCreatedAt(
            messages.filter((m) => !restoredIdsRef.current.has(m.id)).map((m) => m.id),
        )
    }, [messages, stampMessagesCreatedAt])

    // ── #4920 Application 1: refresh the config on a committed revision ──
    // When the agent commits a new revision of itself, the backend emits a one-way
    // `data-committed-revision` part (same channel as `data-trace`), whether the tool asked first
    // or ran directly. On receipt we invalidate the latest-revision and
    // inspect caches so the config panel, section drawers, and build-kit view all re-read the new
    // config. Deduped by revision id so a re-render (token stream) doesn't re-invalidate.
    const committedRevisionsSeenRef = useRef<Set<string>>(new Set())
    const setAgentCommitSignal = useSetAtom(agentSelfCommitSignalAtom)
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
                    // Capture the OUTGOING revision's parameters before switching, so the config
                    // panel can show what the agent changed (per-section indicators + summary).
                    const prevParameters = store.get(
                        workflowMolecule.selectors.configuration(entityId),
                    )
                    setAgentCommitSignal({
                        revisionId: data.revisionId,
                        version: data.version,
                        prevParameters: prevParameters ?? null,
                        at: Date.now(),
                    })
                    switchEntity({currentEntityId: entityId, newEntityId: data.revisionId})
                }
            }
        }
    }, [messages, entityId, switchEntity, store, setAgentCommitSignal])

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
        if (useVirtuoso) return
        // Don't instant-jump while a programmatic glide (SC-1 submit / jump-to-latest) owns the
        // scroll — that snap would override the animation. The glide's own settle re-pins to bottom.
        if (stickRef.current && !programmaticScrollRef.current) scrollToBottom()
    }, [messages, status, scrollToBottom, useVirtuoso])

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
        if (useVirtuoso) return
        const el = scrollRef.current
        if (!el) return
        const onResize = (entries: ResizeObserverEntry[]) => {
            // Pin each rendered row's REAL height as its own `content-visibility` placeholder, so it
            // keeps the exact same box when it later scrolls off-screen. Only meaningful while
            // content-visibility is enabled — otherwise `containIntrinsicSize` is inert, so skip the
            // whole measurement to avoid a getBoundingClientRect + style write per row on every resize.
            if (CONTENT_VISIBILITY_ENABLED) {
                for (const e of entries) {
                    const node = e.target as HTMLElement
                    if (node === el) continue // the viewport itself is not a row — never pin it
                    const check = node.checkVisibility as
                        | ((o?: {contentVisibilityAuto?: boolean}) => boolean)
                        | undefined
                    if (check && !check.call(node, {contentVisibilityAuto: true})) continue
                    const h = Math.round(node.getBoundingClientRect().height)
                    if (h > 0) node.style.containIntrinsicSize = `auto ${h}px`
                }
            }
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
        // Observe the VIEWPORT too: the lazy composer/session-bar regions outside it hydrate a
        // beat after mount and change this element's clientHeight — rows alone don't resize then,
        // so without this the clamp shifts the view (following → re-pin; reading → hold anchor).
        ro.observe(el)
        el.querySelectorAll("[data-mid]").forEach((w) => ro.observe(w))
        return () => ro.disconnect()
    }, [messages.length, scrollToBottom, useVirtuoso])

    // SC-1 (submit) / SC-2 (restore): scroll the log to the bottom, once, when armed. With the active
    // turn reserving a viewport (min-h-full + top padding to clear the fade), "bottom" shows the new
    // question pinned at the top and the answer streaming into the space below — no per-element pin to
    // compute, nothing to keep re-aligning as content arrives. A fresh submit glides; a restore jumps.
    // Follow (stickRef) resumes only ON SETTLE so the per-token follow effect can't jam mid-glide.
    useLayoutEffect(() => {
        if (useVirtuoso) return
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
    }, [messages, animatePinTo, useVirtuoso])

    // Keep the jump pill honest as content streams/settles: show it when the real latest message is
    // below the fold (e.g. a long answer growing past the viewport while parked at the top), and hide
    // it once that message is visible or while we're following. Coalesced (not a sync layout read per
    // streamed render) — the pill is display-only, so one frame of lag is imperceptible.
    useEffect(() => {
        if (useVirtuoso) return
        scheduleShowJump()
    }, [messages, status, scheduleShowJump, useVirtuoso])

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

    // ── SPIKE(virtuoso) scroll wiring (only active when the flag is on) ──
    // Follow = stick to the bottom. Virtuoso's `followOutput` fires on item-count changes only, but the
    // active turn streams inside the Footer (not an item), so drive stick manually on each update.
    const virtFollowRef = useRef(true)
    // While true (a short window after a submit), the follow tracks the bottom SMOOTHLY — so the sent
    // question glides to the top and the streaming answer is tracked continuously (each token retargets
    // the in-flight smooth scroll). Otherwise it snaps instantly to keep up with fast streaming.
    const virtSmoothRef = useRef(false)
    const virtSmoothTimerRef = useRef(0)
    useEffect(() => {
        if (!useVirtuoso || !virtFollowRef.current) return
        const behavior: ScrollBehavior = virtSmoothRef.current ? "smooth" : "auto"
        const id = requestAnimationFrame(() => virtuosoRef.current?.scrollTo({top: 1e9, behavior}))
        return () => cancelAnimationFrame(id)
    }, [messages, status, useVirtuoso])
    // SC-1 reserve for the virtuoso path: `min-h-full` doesn't work inside Virtuoso's Footer (100%
    // resolves against its content-sized list, not the viewport), so measure the scroller's height and
    // reserve it explicitly on the active-turn Footer — that's what lets a sent question pin to the top.
    const virtRoRef = useRef<ResizeObserver | null>(null)
    const [virtViewportH, setVirtViewportH] = useState(0)
    const setVirtScroller = useCallback((el: HTMLElement | Window | null) => {
        virtRoRef.current?.disconnect()
        const node = el instanceof HTMLElement ? el : null
        if (!node) return
        setVirtViewportH(node.clientHeight)
        const ro = new ResizeObserver(() => setVirtViewportH(node.clientHeight))
        ro.observe(node)
        virtRoRef.current = ro
    }, [])
    useEffect(
        () => () => {
            virtRoRef.current?.disconnect()
            window.clearTimeout(virtSmoothTimerRef.current)
        },
        [],
    )
    // SC-1/2 equivalent: on submit/restore (armBottomRef), re-arm follow to the bottom once Virtuoso has
    // mounted + measured (question-at-top emerges from the Footer's viewport reserve). A submit tracks
    // smoothly for a short window; a restore snaps. The follow effect above does the per-token scrolling.
    useLayoutEffect(() => {
        if (!useVirtuoso || !armBottomRef.current) return
        const animate = animateBottomRef.current
        armBottomRef.current = false
        animateBottomRef.current = false
        virtFollowRef.current = true
        setShowJump(false)
        virtSmoothRef.current = animate
        window.clearTimeout(virtSmoothTimerRef.current)
        if (animate) {
            virtSmoothTimerRef.current = window.setTimeout(() => {
                virtSmoothRef.current = false
            }, 600)
        }
        requestAnimationFrame(() =>
            requestAnimationFrame(() =>
                virtuosoRef.current?.scrollTo({top: 1e9, behavior: animate ? "smooth" : "auto"}),
            ),
        )
    }, [messages, useVirtuoso])
    const virtJumpToLatest = useCallback(() => {
        virtFollowRef.current = true
        setShowJump(false)
        virtuosoRef.current?.scrollTo({top: 1e9, behavior: "smooth"})
    }, [])
    // Stable component identities (Virtuoso remounts these if their identity changes). They read live
    // content from `context`, which we pass fresh each render — so they re-render without remounting.
    const virtComponents = useMemo<Components<UIMessage, VirtCtx>>(
        () => ({
            Header: ({context}) => <>{context?.header ?? null}</>,
            Footer: ({context}) => <>{context?.footer ?? null}</>,
        }),
        [],
    )

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
        // The message left the composer — drop its persisted draft (and any pending capture).
        window.clearTimeout(draftTimerRef.current)
        composerDraftBySession.delete(sessionId)
        // Sending consumes the template provenance along with the composer text.
        if (TEMPLATE_STRIP_MODE) stripProvenance.clear()
        setFiles([])
        setRejections([])
        setAttachmentsOpen(false)
    }

    // First-run auto-start: a freshly-created agent lands with a seeded prompt, but its model is often
    // gated (no provider key yet). Connecting the key IS the go-ahead — so once the gate clears we send
    // the seeded prompt automatically, rather than making them click Start a second time ("no explicit
    // action twice"). Fires once, while the conversation is still empty, when EITHER: the model just
    // unblocked (was gated), OR the seed is an explicit "go" (`firstRunAutoSend` — the onboarding
    // Create-agent click) and the model is ready. A redirect-seed that merely arrived with a ready model
    // still waits for Start. `handleSubmit` is read via a ref so the transition drives the send.
    const handleSubmitRef = useRef(handleSubmit)
    handleSubmitRef.current = handleSubmit
    const autoStartedSeedRef = useRef(false)
    const seedWasBlockedRef = useRef(false)
    // Turn 1 must run WITH the build-kit overlay, but the overlay fetch can resolve after the seed
    // lands — so gate the auto-send on the overlay having settled (present or definitively absent).
    const overlayReady = useAtomValue(workflowBuildKitOverlayReadyAtomFamily(entityId))
    // Bounded wait: a broken overlay endpoint must not hang the first turn forever. Once a seed is
    // pending, wait at most 10s for the overlay, then send anyway (kit-less) with a warning.
    const [overlayWaitElapsed, setOverlayWaitElapsed] = useState(false)
    // A new entity/session or a fresh pending seed restarts the bounded wait from zero.
    useEffect(() => {
        setOverlayWaitElapsed(false)
    }, [entityId, firstRunPrompt])
    // Arm the timeout only when the auto-send is blocked on nothing BUT the overlay: a pending seed
    // whose model is ready and which would otherwise fire this turn. Otherwise a still-gated model
    // (or an already-sent seed) would burn the 10s window before the overlay ever mattered.
    const sendBlockedOnlyOnOverlay =
        Boolean(firstRunPrompt) &&
        !autoStartedSeedRef.current &&
        !modelBlocked &&
        (seedWasBlockedRef.current || firstRunAutoSend) &&
        messages.length === 0 &&
        !overlayReady
    useEffect(() => {
        if (!sendBlockedOnlyOnOverlay || overlayWaitElapsed) return
        const timer = setTimeout(() => {
            console.warn(
                "[AgentChat] build-kit overlay not ready after 10s; sending seed without it",
            )
            setOverlayWaitElapsed(true)
        }, 10_000)
        return () => clearTimeout(timer)
    }, [sendBlockedOnlyOnOverlay, overlayWaitElapsed])
    useEffect(() => {
        if (!firstRunPrompt || autoStartedSeedRef.current) return
        if (modelBlocked) {
            seedWasBlockedRef.current = true
            return
        }
        if ((!seedWasBlockedRef.current && !firstRunAutoSend) || messages.length > 0) return
        // Hold the auto-send until the build-kit overlay settles (or the 10s bound elapses).
        if (!overlayReady && !overlayWaitElapsed) return
        autoStartedSeedRef.current = true
        handleSubmitRef.current(firstRunPrompt)
    }, [
        firstRunPrompt,
        firstRunAutoSend,
        modelBlocked,
        messages.length,
        overlayReady,
        overlayWaitElapsed,
    ])

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
                modal.confirm({
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
        [regenerate, setMessages, modal],
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
        const isInspected = isAssistantTurn && message.id === inspectedTurnId
        const onInspect =
            turnInspectorOpen && isAssistantTurn
                ? () => setRightPanel({mode: "turn", sessionId, assistantMessageId: message.id})
                : undefined
        const showInspect = buildMode && isAssistantTurn
        const showWorking =
            isLast && busy && (!isAssistantTurn || message.parts.some(isVisiblePart))
        return (
            <MessageRow
                key={message.id}
                mid={message.id}
                enter={enter}
                inspected={isInspected}
                onInspect={onInspect}
                // Content-visibility on settled rows — gated by CONTENT_VISIBILITY_ENABLED (currently
                // off) and never under Virtuoso (it windows + would corrupt measurement).
                offscreenSkip={CONTENT_VISIBILITY_ENABLED && !useVirtuoso && index < activeStart}
            >
                <AgentMessage
                    message={message}
                    isStreaming={busy && isLast}
                    isLastMessage={isLast}
                    onRewind={handleRewind}
                    onClientToolOutput={handleClientToolOutput}
                    precededByEmptyAssistant={
                        index > 0 && isEmptyAssistantTurn(messages[index - 1])
                    }
                    turnTraceId={turnTraceId}
                />
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
                {/* Meta row: "Inspect turn" + the working dots share ONE compact line under the
                    turn. The dots run for the WHOLE busy run — so gaps with no streaming output
                    (approval-resume cold-replay, between steps, server tool waits) never read as
                    frozen — and drop the moment the run settles. The affordance renders FIRST so
                    its left edge stays put (and aligned with older turns') when the trailing dots
                    unmount — no settle-time layout shift. An EMPTY streaming assistant turn
                    already renders its own loading bubble (AgentMessage), so the dots skip it —
                    exactly one indicator while busy. */}
                {(showWorking || showInspect) && (
                    <div className="flex items-center gap-2 self-start">
                        {showInspect && (
                            <button
                                type="button"
                                onClick={() =>
                                    setRightPanel({
                                        mode: "turn",
                                        sessionId,
                                        assistantMessageId: message.id,
                                    })
                                }
                                className="flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs text-colorTextSecondary transition-colors hover:text-colorPrimary"
                            >
                                <TreeStructure size={12} />
                                Inspect turn
                            </button>
                        )}
                        {showWorking && <WorkingDots />}
                    </div>
                )}
            </MessageRow>
        )
    }

    // Strip era (TEMPLATE_STRIP_MODE): the bare "what do you want to build?" hero (no messages yet,
    // nothing pending, not browsing the template gallery) is when the onboarding TemplateStrip docks
    // directly above the composer, mirroring the agent-chat strip's bottom-anchored rhythm.
    const showBareOnboardingHero =
        TEMPLATE_STRIP_MODE &&
        onboardingActive &&
        messages.length === 0 &&
        !pendingFirstTurn &&
        !onboarding?.browseAll

    return (
        // Ambient drive session: in-thread file cards + rail resolve files against THIS
        // conversation without prop-threading through the message tree.
        <DriveSessionProvider sessionId={sessionId}>
            <div
                className="ag-canvas relative flex h-full min-h-0 w-full flex-row"
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                {/* Themed confirm dialogs (rewind-past-a-tool) mount through this holder. */}
                {modalContextHolder}
                {quickLookHost}
                {/* Resizable [chat | right panel] split. The panel (turn inspector OR session content)
                pushes the chat aside rather than overlaying it, and collapses to 0 when closed. */}
                <RightPanelSplit
                    open={rightPanelOpen}
                    panel={<RightPanel sessionId={sessionId} messages={messages} />}
                >
                    <div className="flex h-full min-h-0 w-full min-w-0">
                        <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col gap-3">
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
                                {useVirtuoso && messages.length > 0 && (
                                    <Virtuoso<UIMessage, VirtCtx>
                                        ref={virtuosoRef}
                                        scrollerRef={setVirtScroller}
                                        data={messages.slice(0, activeStart)}
                                        className="ag-canvas flex-1 [overflow-anchor:none]"
                                        style={{
                                            maskImage: EDGE_FADE_MASK,
                                            WebkitMaskImage: EDGE_FADE_MASK,
                                        }}
                                        // Wide buffer so rows are rendered AND measured before they enter view — the
                                        // height correction (85–1022px vs the estimate) then happens off-screen, so
                                        // real content scrolls in without blanks or jitter. Tunable from settings.
                                        increaseViewportBy={{
                                            top: virtOverscan,
                                            bottom: Math.round(virtOverscan * 0.66),
                                        }}
                                        defaultItemHeight={virtItemEstimate}
                                        // A prior mount's snapshot restores true row heights + scroll in the
                                        // first frame; only a genuinely first visit anchors by index (the two
                                        // props conflict, so exactly one is passed).
                                        {...(virtRestoreState
                                            ? {restoreStateFrom: virtRestoreState}
                                            : {
                                                  initialTopMostItemIndex: {
                                                      index: Math.max(0, activeStart - 1),
                                                      align: "end" as const,
                                                  },
                                              })}
                                        computeItemKey={(_i, m) => m.id}
                                        itemContent={(index, m) => (
                                            <div className="px-3 pb-3">
                                                {renderMessage(m, index)}
                                            </div>
                                        )}
                                        atBottomStateChange={(atBottom) => {
                                            virtFollowRef.current = atBottom
                                            setShowJump(!atBottom)
                                        }}
                                        context={{
                                            header: <div className="pt-8" />,
                                            footer:
                                                activeStart < messages.length ? (
                                                    <div
                                                        // `pb-8` ≥ the 28px bottom fade so the meta row clears it at rest.
                                                        className={`flex flex-col gap-3 px-3 pb-8${reserveActive ? " pt-8" : ""}`}
                                                        // Explicit viewport-height reserve (min-h-full is inert in the
                                                        // Footer) so scrolling to bottom pins the question to the top.
                                                        style={
                                                            reserveActive && virtViewportH
                                                                ? {minHeight: virtViewportH}
                                                                : undefined
                                                        }
                                                    >
                                                        {messages
                                                            .slice(activeStart)
                                                            .map((m, i) =>
                                                                renderMessage(m, activeStart + i),
                                                            )}
                                                    </div>
                                                ) : null,
                                        }}
                                        components={virtComponents}
                                    />
                                )}
                                {(!useVirtuoso || messages.length === 0) && (
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
                                        // `pt-8`/`pb-8` (32px) ≥ the 28px fades so the first message and the last turn's
                                        // meta row (Inspect turn + streaming dots) clear them at rest; the bottom pad
                                        // + `[overflow-anchor:none]` are the SC scroll-engineering essentials (browser
                                        // anchoring off so our pin/anchor logic owns the scroll position).
                                        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 pt-8 pb-8 [overflow-anchor:none]"
                                        // Fade content into the top edge (under the tab bar) and the bottom edge (into the
                                        // composer) as it scrolls. A gradient mask on the scroll container: transparent at
                                        // each edge → opaque across the middle. GPU-composited, no JS, theme-agnostic.
                                        style={{
                                            maskImage: EDGE_FADE_MASK,
                                            WebkitMaskImage: EDGE_FADE_MASK,
                                        }}
                                    >
                                        {messages.length === 0 &&
                                            (pendingFirstTurn ? (
                                                // Optimistic first turn: the submitted description as a sent user bubble +
                                                // an assistant loading placeholder (mirrors a real `status:"submitted"`
                                                // turn), so the commit reads as one continuous chat, not an empty state.
                                                <MessageRow mid="pending-first-turn" enter>
                                                    <AgentMessage
                                                        message={pendingFirstMessage}
                                                        isLastMessage
                                                        onRewind={handleRewind}
                                                        onClientToolOutput={handleClientToolOutput}
                                                    />
                                                    <Bubble
                                                        placement="start"
                                                        variant="borderless"
                                                        loading
                                                        content=""
                                                    />
                                                </MessageRow>
                                            ) : onboardingActive && onboarding?.browseAll ? (
                                                // "Browse all templates" swaps the hero for the full gallery IN PLACE.
                                                <OnboardingBrowseTemplates />
                                            ) : isHydrating ? (
                                                // Server-history hydration in flight — skeleton, not the "start a
                                                // chat" hero, so a durable session doesn't flash the empty state.
                                                <TranscriptSkeleton />
                                            ) : (
                                                <AgentChatEmptyState
                                                    entityId={entityId}
                                                    onStart={handleSubmit}
                                                    firstRunPrompt={firstRunPrompt}
                                                    canStart={!modelBlocked}
                                                    onboarding={onboardingActive}
                                                    onPrefill={(text) =>
                                                        richInputRef.current?.setMarkdown(text)
                                                    }
                                                />
                                            ))}
                                        {messages
                                            .slice(0, activeStart)
                                            .map((m, i) => renderMessage(m, i))}
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
                                                    .map((m, i) =>
                                                        renderMessage(m, activeStart + i),
                                                    )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Always mounted so it can fade + slide in/out; hidden state is non-interactive and
                    keeps `-translate-x-1/2` (Tailwind composes x/y translate on one transform). */}
                                <Button
                                    size="small"
                                    shape="round"
                                    icon={<ArrowDown size={14} />}
                                    onClick={useVirtuoso ? virtJumpToLatest : jumpToLatest}
                                    tabIndex={showJump ? 0 : -1}
                                    aria-hidden={!showJump}
                                    // Solid elevated surface + border + shadow so the pill reads clearly when it
                                    // floats over streamed text (a transparent pill let the text bleed through).
                                    className={`!absolute bottom-2 left-1/2 -translate-x-1/2 !border !border-solid !border-colorBorderSecondary !bg-colorBgElevated shadow-md transition-[opacity,transform] duration-200 ease-out ${
                                        showJump
                                            ? "translate-y-0 opacity-100"
                                            : "pointer-events-none translate-y-3 opacity-0"
                                    }`}
                                    aria-label="Jump to latest message"
                                >
                                    Jump to latest
                                </Button>
                            </div>

                            {/* Queue sits BETWEEN the messages and the composer, so showing it never shifts the
                composer (and the editor) upward. Streaming itself is signalled by the composer's
                send button (it becomes a spinning Stop button), so there's no "Streaming…" row. */}
                            <RevealCollapse open={queued.length > 0} className={CHAT_COLUMN}>
                                <div className="flex items-center gap-2 px-3 pb-2">
                                    <QueuedMessages
                                        queued={queued}
                                        onRemove={removeQueued}
                                        onClear={clearQueue}
                                    />
                                </div>
                            </RevealCollapse>

                            {/* Rich markdown composer (Lexical). Enter sends; attachments via header/prefix slots.
                Wrapper `px-3` keeps the session-bar gutter; the input centers on CHAT_COLUMN so it
                aligns with the (also centered) message column when the panel is wide. The persistent
                HITL approval dock lives in this same block (above the input) — always mounted so it
                animates in/out, and inside the composer region so the paused gate can't scroll out
                of reach and its collapse adds no gap to the surrounding column. */}
                            {/* The whole composer fades + rises in ONCE on mount (Reveal), so the input joins the
                    empty-state/hero entrance instead of popping. Mount-only: it never remounts across the
                    onboarding→chat transitions, so this never reintroduces layout shift on state changes. */}
                            <Reveal className="px-3" enabled={playComposerEntrance}>
                                {/* Agent empty-chat strip (S6): docked above the composer, unmounts once a
                        message exists or a first-run prompt is pending. Build-mode + fresh-agent
                        only — never in maximized chat mode, and gone for good after any commit. */}
                                {TEMPLATE_STRIP_MODE &&
                                !onboardingActive &&
                                buildMode &&
                                isFreshAgentRevision &&
                                messages.length === 0 &&
                                !firstRunPrompt &&
                                !pendingFirstTurn ? (
                                    <div className={`${CHAT_COLUMN} mb-3`}>
                                        <TemplateStrip
                                            surface="agent-chat"
                                            selectedTemplateKey={
                                                stripProvenance.selectedTemplateKey
                                            }
                                            onPick={handleStripPick}
                                            surfaceColorVar="--ag-surface-chat"
                                        />
                                    </div>
                                ) : null}
                                {/* Always mounted so it animates in/out (RevealCollapse) instead of popping. Pre-commit
                        onboarding SUPPRESSES it — the provider-key check is deferred until the agent is
                        committed (Create-agent then runs the connect→unlock→auto-send flow on the real agent). */}
                                <div className={CHAT_COLUMN}>
                                    <ConnectModelBanner {...modelKey} suppressed={chromeHidden} />
                                </div>
                                <ApprovalDock
                                    className={CHAT_COLUMN}
                                    approvals={pendingApprovals}
                                    onApprovalResponse={handleApprovalResponse}
                                    onViewTrace={openPausedTurnTrace}
                                    entityId={entityId}
                                />
                                {/* Owner call: a template pick must not shift the composer, so no chip renders here
                        (unlike the home surface) — the strip card's own selected state is the
                        "which template" indicator; the composer text is the only other feedback. */}
                                {/* Onboarding strip: docked directly above the composer (mb-3 gap), mirroring the
                        agent-chat strip's rhythm — hero stays top-aligned above the flex space, and
                        the strip + composer read as one bottom-anchored cluster. */}
                                {showBareOnboardingHero ? (
                                    <div className={`${CHAT_COLUMN} mb-3`}>
                                        <TemplateStrip
                                            surface="onboarding"
                                            selectedTemplateKey={
                                                stripProvenance.selectedTemplateKey
                                            }
                                            onPick={handleStripPick}
                                            surfaceColorVar="--ag-surface-chat"
                                        />
                                    </div>
                                ) : null}
                                {/* Composer region hydrates independently (Lexical chunk); the fallback is the
                        same skeleton the pane-level gates render for this slot, so the box never
                        changes shape — the editor just materializes inside it. */}
                                <Suspense
                                    fallback={
                                        <ComposerSkeleton className={`${CHAT_COLUMN} mb-3`} />
                                    }
                                >
                                    <RichChatInput
                                        ref={richInputRef}
                                        className={`${CHAT_COLUMN} mb-3`}
                                        // Onboarding: submit = commit the ephemeral — Enter creates the agent
                                        // (matching the composer's "↵ Send" hint); ⌘/Shift+Enter inserts newlines
                                        // for longer descriptions.
                                        onSubmit={
                                            onboardingActive
                                                ? () => handleCreateAgent()
                                                : handleSubmit
                                        }
                                        disabled={
                                            onboardingActive ? ideHandoffActive : modelBlocked
                                        }
                                        hideSendButton={onboardingActive}
                                        placeholder={
                                            onboardingActive
                                                ? ideHandoffActive
                                                    ? "Continue in your IDE from the steps above — or start over."
                                                    : "e.g. Watch our #support channel, triage each thread by urgency, and route it to the right owner — ask me before closing anything."
                                                : modelBlocked
                                                  ? "Connect a model to start chatting…"
                                                  : "Ask the agent… (Enter to send, ⌘/Ctrl+Enter for newline)"
                                        }
                                        initialMarkdown={initialDraft}
                                        onChange={handleComposerChange}
                                        onPasteFile={(pasted) => addFiles(Array.from(pasted))}
                                        sendForceEnabled={files.length > 0}
                                        streaming={busy}
                                        onStop={handleStop}
                                        prefix={
                                            // Attach button is gated until the agent service is ready for inline
                                            // file parts (big-agents d4b119af26); paste / drag-to-add still work.
                                            <Tooltip
                                                title={
                                                    atMax
                                                        ? `Up to ${limits.maxCount} files`
                                                        : "Attach files coming soon"
                                                }
                                            >
                                                <Button
                                                    type="text"
                                                    icon={<Paperclip size={16} />}
                                                    disabled={true}
                                                    onClick={() =>
                                                        setAttachmentsOpen((open) => !open)
                                                    }
                                                    aria-label="Attach files"
                                                />
                                            </Tooltip>
                                        }
                                        header={
                                            <HeightCollapse
                                                open={attachmentsOpen || files.length > 0}
                                            >
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
                                        trailing={
                                            onboardingActive ? (
                                                ideHandoffActive ? (
                                                    <Button
                                                        onClick={handleStartOver}
                                                        className="!shadow-none"
                                                    >
                                                        Start over
                                                    </Button>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        {TEMPLATE_STRIP_MODE ? (
                                                            // Strip era: the IDE handoff is a one-click copy + toast, no modal/bubble.
                                                            <Button
                                                                icon={<Terminal size={15} />}
                                                                onClick={handleCodingAgentCopy}
                                                                className="!shadow-none"
                                                            >
                                                                {STRIP_COPY.useCodingAgent}
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                icon={<Code size={14} />}
                                                                onClick={streamIdeBubble}
                                                                className="!shadow-none"
                                                            >
                                                                Continue in IDE
                                                            </Button>
                                                        )}
                                                        <Button
                                                            type="primary"
                                                            icon={<ArrowRight size={14} />}
                                                            iconPosition="end"
                                                            loading={!!onboarding?.committing}
                                                            onClick={handleCreateAgent}
                                                            className="!shadow-none"
                                                        >
                                                            Create agent
                                                        </Button>
                                                    </div>
                                                )
                                            ) : undefined
                                        }
                                    />
                                </Suspense>
                            </Reveal>
                        </div>
                        {/* Chat-mode context rail (spec E1): docked right of the transcript, Files
                            pinned on top. Always mounted so hide/show SLIDES (width transition) —
                            hidden in build mode and while the Turn/Session panel owns the right
                            edge. */}
                        <ContextRail
                            sessionId={sessionId}
                            busy={busy}
                            hidden={buildMode || rightPanelOpen || railHeldByModeSwitch}
                            onOpenFiles={() =>
                                setRightPanel({mode: "session", sessionId, tab: "mounts"})
                            }
                        />
                    </div>
                </RightPanelSplit>
                {TEMPLATE_STRIP_MODE ? (
                    <CopiedToast
                        open={copiedToastOpen}
                        text={STRIP_COPY.copiedToast}
                        onDone={() => setCopiedToastOpen(false)}
                    />
                ) : null}
            </div>
        </DriveSessionProvider>
    )
}

export default AgentConversation
