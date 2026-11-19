import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react"

import {
    FILES_PANE_MAX,
    FILES_PANE_MIN,
    filesPaneWidthAtom,
    useFilesPaneLayout,
} from "@agenta/chat/state"
import {configPaneRevealRequestAtom} from "@agenta/chat/state"
import {DriveLinkContext, SessionFilesPane, useSessionFilesPane} from "@agenta/entity-ui/drive"
import {userAtom} from "@agenta/shared/state"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {useMediaQuery} from "@agenta/ui/hooks"
import {cn} from "@agenta/ui/styles"
import {useAtom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {ConfigPaneLoading} from "../chat/states/ConfigPaneLoading"
import {useDriveUrlSync} from "../chat/useDriveUrlSync"

import {AgentPanelContext, type AgentPanelApi} from "./agentPanelContext"
import {
    agentPanelStateAtomFamily,
    nextPanelContent,
    OVERLAY_BELOW,
    PANEL_MAX,
    PANEL_MIN,
    PANEL_WIDE,
    panelStateKey,
    PHONE_BELOW,
    type PanelContent,
} from "./agentPanelState"
import {LeaveGuardProvider, useConfirmLeave} from "./leaveGuard"
import {builderPanelSlotAtom} from "./panelSlots"

// Each content loads on first use, so the session page does not carry it.
const ConfigurationContent = dynamic(
    () => import("./ConfigurationContent").then((m) => m.ConfigurationContent),
    {ssr: false, loading: ConfigPaneLoading},
)

interface AgentLayoutProps {
    agentId: string | null
    sessionId: string
    /** The revision the Configuration content edits. Null: no configuration (hidden agent, no agent). */
    revisionId: string | null
    workspaceId: string
    projectId: string
    /** Mirror the Files selection in the URL; only where the URL names this session. */
    deepLinks: boolean
    /** The session header. It reads the panel through `useAgentPanel`. */
    header: ReactNode
    /** The conversation. It stays mounted exactly once at every width. */
    conversation: ReactNode
}

/** True when a route leaves the agent on screen (another agent, or a page that is not an agent's). */
const leavesAgentFor = (agentId: string | null, sessionId: string) => (url: string) => {
    const path = url.split("?")[0]
    if (path.includes(`/sessions/${sessionId}`)) return false
    return !(agentId && path.includes(`/agents/${agentId}`))
}

/**
 * The agent layout host: the leave guard, the session header and the one right panel beside the
 * conversation. The panel shows Files, Configuration or Builder, one at a time.
 */
export const AgentLayout = (props: AgentLayoutProps) => {
    const {agentId, sessionId} = props
    // Another session of the same agent keeps the panel; the session route decides the rest.
    const leavesAgent = useMemo(() => leavesAgentFor(agentId, sessionId), [agentId, sessionId])
    return (
        <LeaveGuardProvider leavesAgent={leavesAgent}>
            <AgentLayoutBody {...props} />
        </LeaveGuardProvider>
    )
}

const AgentLayoutBody = ({
    agentId,
    sessionId,
    revisionId,
    workspaceId,
    projectId,
    deepLinks,
    header,
    conversation,
}: AgentLayoutProps) => {
    const confirmLeave = useConfirmLeave()
    const user = useAtomValue(userAtom)
    const [state, setState] = useAtom(
        agentPanelStateAtomFamily(panelStateKey(user?.id ?? "anonymous", projectId)),
    )
    const twoPane = useMediaQuery(`(min-width: ${PHONE_BELOW}px)`)
    const pushWidth = useMediaQuery(`(min-width: ${OVERLAY_BELOW}px)`)
    const phone = !twoPane
    const [wide, setWide] = useState(false)

    // Files keeps its production open state, width and URL sync; the panel follows it.
    const filesScope = agentId ?? sessionId
    const files = useSessionFilesPane(filesScope, sessionId)
    const driveLink = useDriveUrlSync({sessionId, open: files.open, enabled: deepLinks})
    const filesLayout = useFilesPaneLayout(
        `m:${workspaceId}:${projectId}:${filesScope}`,
        sessionId,
        files.open,
    )
    const [storedFilesWidth, setStoredFilesWidth] = useAtom(filesPaneWidthAtom)
    const [filesWidth, setFilesWidth] = useState(storedFilesWidth)
    useEffect(() => setFilesWidth(storedFilesWidth), [storedFilesWidth])

    const builder = useAtomValue(builderPanelSlotAtom)
    const canConfigure = Boolean(revisionId && agentId)
    const available = useMemo<Record<PanelContent, boolean>>(
        () => ({files: true, configuration: canConfigure, builder: Boolean(builder && agentId)}),
        [canConfigure, builder, agentId],
    )
    // A content the screen cannot show (no configuration, no builder) stays closed.
    const stored = state.content
    const content: PanelContent | null = files.open
        ? "files"
        : stored === "configuration" && canConfigure
          ? "configuration"
          : stored === "builder" && builder && agentId
            ? "builder"
            : null

    // The Files pane's own close (and a deep link) moves the panel with it.
    // These two effects run in this order (restore, then follow): the restore resets
    // `filesWasOpen`, so the follow never reads a scope change as a close.
    const filesWasOpen = useRef(files.open)
    // A stored Files content opens Files again after a reload, through its own open state. Files
    // is scoped by agent, and the scope changes once the agent resolves: each new scope restores
    // again, and a scope change is never read as a close.
    const restoredScope = useRef<string | null>(null)
    useEffect(() => {
        if (restoredScope.current === filesScope) return
        restoredScope.current = filesScope
        filesWasOpen.current = files.open
        if (stored === "files" && !files.open) files.toggle()
    }, [filesScope, stored, files])

    useEffect(() => {
        if (files.open && !filesWasOpen.current) setState({content: "files"})
        if (!files.open && filesWasOpen.current && stored === "files") setState({content: null})
        filesWasOpen.current = files.open
    }, [files.open, stored, setState])

    const setContent = useCallback(
        (next: PanelContent | null) => {
            if (next === "files") files.toggle()
            else if (files.open) files.close()
            setState({content: next})
            setWide(false)
        },
        [files, setState],
    )

    // The panel takes the focus when it opens, so Escape reaches it.
    const panelRef = useRef<HTMLDivElement>(null)
    const toggle = useCallback(
        async (clicked: PanelContent) => {
            // A content this screen cannot show (a hidden agent, no builder yet) is not offered.
            if (!available[clicked]) return false
            const next = nextPanelContent(content, clicked)
            if (!(await confirmLeave(next ? "swap" : "close"))) return false
            setContent(next)
            if (next) requestAnimationFrame(() => panelRef.current?.focus())
            return true
        },
        [confirmLeave, content, setContent, available],
    )
    const close = useCallback(async () => {
        if (!(await confirmLeave("close"))) return false
        const was = content
        setContent(null)
        // Escape or Close at the root: focus goes back to the header icon that opened it.
        if (was) document.getElementById(`agent-panel-icon-${was}`)?.focus()
        return true
    }, [confirmLeave, content, setContent])

    // "Show me the configuration" from elsewhere (model setup, the agent overview, a new agent).
    const [revealRequest, setRevealRequest] = useAtom(configPaneRevealRequestAtom)
    useEffect(() => {
        if (!revealRequest || !canConfigure) return
        setRevealRequest(false)
        // Configuration already open on another tab: only the tab changes, nothing is left.
        if (content === "configuration") {
            setState({configTab: "agent"})
            return
        }
        void confirmLeave("swap").then((ok) => {
            if (!ok) return
            setContent("configuration")
            setState({configTab: "agent"})
        })
    }, [revealRequest, canConfigure, content, confirmLeave, setContent, setState, setRevealRequest])

    // "Create with AI" fills the composer. On a phone the panel covers it, so hand the screen back.
    const prefillRequest = useAtomValue(composerPrefillRequestAtom)
    const lastPrefill = useRef(prefillRequest)
    useEffect(() => {
        if (prefillRequest === lastPrefill.current) return
        lastPrefill.current = prefillRequest
        if (prefillRequest && phone && content) void close()
    }, [prefillRequest, phone, content, close])

    const api = useMemo<AgentPanelApi>(
        () => ({
            content,
            toggle,
            close,
            configTab: state.configTab,
            setConfigTab: (configTab) => setState({configTab}),
            wide,
            setWide,
            phone,
            available,
        }),
        [content, toggle, close, state.configTab, setState, wide, phone, available],
    )

    // Contents stay mounted after first use (hidden), so a swap keeps their state and an upload
    // in Files is never aborted.
    const [mounted, setMounted] = useState<Set<PanelContent>>(new Set())
    useEffect(() => {
        if (content && !mounted.has(content)) setMounted(new Set(mounted).add(content))
    }, [content, mounted])

    const [liveWidth, setLiveWidth] = useState(state.width)
    useEffect(() => setLiveWidth(state.width), [state.width])
    const isFiles = content === "files"
    const panelWidth = isFiles ? filesWidth : wide ? PANEL_WIDE : liveWidth
    const filesExpanded = isFiles && filesLayout.expanded

    const panelBody = (
        <div
            ref={panelRef}
            tabIndex={-1}
            data-testid="agent-panel"
            className="ag-panel-raised flex h-full min-h-0 w-full flex-col outline-none"
            onKeyDown={(event) => {
                // A view goes back first (the view stack handles it); a menu or dialog closes
                // itself. What is left closes the panel.
                if (event.key !== "Escape" || event.defaultPrevented) return
                const layer = (event.target as HTMLElement).closest?.(
                    '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
                )
                if (layer && layer !== event.currentTarget) return
                event.preventDefault()
                void close()
            }}
        >
            {mounted.has("files") || isFiles ? (
                <div className={isFiles ? "h-full min-h-0" : "hidden"}>
                    <DriveLinkContext.Provider value={driveLink.copyLink}>
                        <SessionFilesPane
                            scope={filesScope}
                            sessionId={sessionId}
                            onSelectionChange={driveLink.onSelectionChange}
                            // The header icon closes it on desktop; on a phone the header is
                            // covered, so the pane's own back arrow does.
                            closeControl={phone ? "back" : "none"}
                            expanded={filesLayout.expanded}
                            onToggleExpand={filesLayout.toggleExpand}
                        />
                    </DriveLinkContext.Provider>
                </div>
            ) : null}
            {canConfigure && (mounted.has("configuration") || content === "configuration") ? (
                <div className={content === "configuration" ? "h-full min-h-0" : "hidden"}>
                    <ConfigurationContent
                        key={agentId}
                        agentId={agentId!}
                        revisionId={revisionId!}
                        sessionId={sessionId}
                        filesScope={filesScope}
                        workspaceId={workspaceId}
                        projectId={projectId}
                    />
                </div>
            ) : null}
            {builder && agentId && (mounted.has("builder") || content === "builder") ? (
                <div className={content === "builder" ? "h-full min-h-0" : "hidden"}>
                    {builder({agentId, sessionId, workspaceId, projectId})}
                </div>
            ) : null}
        </div>
    )

    const open = content !== null
    // One tree at every width, so neither a resize nor a mode change remounts the conversation:
    // push = side by side; overlay = the panel lies over the conversation; full = it covers it.
    const mode =
        phone || filesExpanded ? "full" : !pushWidth || (wide && !isFiles) ? "overlay" : "push"
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const startX = event.clientX
        const startWidth = panelWidth
        const [min, max] = isFiles ? [FILES_PANE_MIN, FILES_PANE_MAX] : [PANEL_MIN, PANEL_MAX]
        const widthAt = (x: number) => Math.min(max, Math.max(min, startWidth + startX - x))
        const move = (e: PointerEvent) =>
            (isFiles ? setFilesWidth : setLiveWidth)(widthAt(e.clientX))
        const up = (e: PointerEvent) => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", up)
            // Stored at pointer-up, not on every move.
            if (isFiles) setStoredFilesWidth(widthAt(e.clientX))
            else setState({width: widthAt(e.clientX)})
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", up)
        event.preventDefault()
    }
    const body = (
        <div className="relative flex h-full min-h-0">
            <div
                className={cn(
                    "ag-canvas flex h-full min-h-0 min-w-0 flex-1 flex-col",
                    mode === "full" && open && "hidden",
                )}
                inert={mode === "full" && open}
            >
                {conversation}
            </div>
            <div
                className={cn(
                    "h-full min-h-0 shrink-0",
                    !open && "hidden",
                    mode === "overlay" &&
                        "absolute inset-y-0 right-0 z-20 shadow-[-8px_0_24px_rgba(0,0,0,0.12)]",
                    mode === "full" && "absolute inset-0",
                    mode === "push" && "relative",
                    mode !== "full" && "border-0 border-l border-solid border-colorBorderSecondary",
                )}
                style={mode === "full" ? undefined : {width: panelWidth}}
            >
                {mode !== "full" && !(wide && !isFiles) ? (
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-valuemin={isFiles ? FILES_PANE_MIN : PANEL_MIN}
                        aria-valuemax={isFiles ? FILES_PANE_MAX : PANEL_MAX}
                        aria-valuenow={panelWidth}
                        className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize"
                        onPointerDown={startDrag}
                    />
                ) : null}
                {panelBody}
            </div>
        </div>
    )

    return (
        <AgentPanelContext.Provider value={api}>
            <div className="flex h-full min-h-0 flex-col">
                {header}
                <div className="min-h-0 flex-1">{body}</div>
            </div>
        </AgentPanelContext.Provider>
    )
}
