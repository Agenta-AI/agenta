import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react"

import {FILES_PANE_MAX, FILES_PANE_MIN, filesPaneWidthAtom, useFilesPaneLayout} from "@agenta/chat/state"
import {
    DriveLinkContext,
    SessionFilesPane,
    useSessionFilesPane,
} from "@agenta/entity-ui/drive"
import {userAtom} from "@agenta/shared/state"
import {useMediaQuery} from "@agenta/ui/hooks"
import {cn} from "@agenta/ui/styles"
import {atom, useAtom, useAtomValue} from "jotai"
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

// Each content loads on first use, so the session page does not carry it.
const ConfigurationContent = dynamic(
    () => import("./ConfigurationContent").then((m) => m.ConfigurationContent),
    {ssr: false, loading: ConfigPaneLoading},
)

/**
 * The Builder content. Wave 2 (the builder panel) registers it; until then the Builder icon is
 * hidden and there is nothing to show.
 */
export const builderPanelContentAtom = atom<
    ((props: {agentId: string; sessionId: string; workspaceId: string; projectId: string}) => ReactNode) | null
>(null)

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
    const wideWindow = useMediaQuery(`(min-width: ${OVERLAY_BELOW}px)`)
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

    const builder = useAtomValue(builderPanelContentAtom)
    const canConfigure = Boolean(revisionId && agentId)
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
    const filesWasOpen = useRef(files.open)
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

    const toggle = useCallback(
        async (clicked: PanelContent) => {
            const next = nextPanelContent(content, clicked)
            if (!(await confirmLeave(next ? "swap" : "close"))) return false
            setContent(next)
            return true
        },
        [confirmLeave, content, setContent],
    )
    const close = useCallback(async () => {
        if (!(await confirmLeave("close"))) return false
        const was = content
        setContent(null)
        // Escape or Close at the root: focus goes back to the header icon that opened it.
        if (was) document.getElementById(`agent-panel-icon-${was}`)?.focus()
        return true
    }, [confirmLeave, content, setContent])

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
        }),
        [content, toggle, close, state.configTab, setState, wide, phone],
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
        <div data-testid="agent-panel" className="ag-panel-raised flex h-full min-h-0 w-full flex-col">
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
    const mode = phone || filesExpanded ? "full" : !wideWindow || (wide && !isFiles) ? "overlay" : "push"
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const startX = event.clientX
        const startWidth = panelWidth
        const [min, max] = isFiles ? [FILES_PANE_MIN, FILES_PANE_MAX] : [PANEL_MIN, PANEL_MAX]
        const widthAt = (x: number) => Math.min(max, Math.max(min, startWidth + startX - x))
        const move = (e: PointerEvent) => (isFiles ? setFilesWidth : setLiveWidth)(widthAt(e.clientX))
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
