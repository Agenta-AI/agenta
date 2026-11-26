import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {CONFIG_REVEAL_TTL_MS, configPaneRevealRequestAtom} from "@agenta/chat/state"
import {
    driveQuickLookAtomFamily,
    DriveLinkContext,
    filesDrawerStagedAtomFamily,
    SessionFilesPane,
    useSessionFilesPane,
} from "@agenta/entity-ui/drive"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import agentLayoutPhoneCatalog from "@agenta/i18n/catalogs/agentLayout.phone"
import {userAtom} from "@agenta/shared/state"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {useMediaQuery} from "@agenta/ui/hooks"
import {PhoneScreenHeader, useIsPhone} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {restartSystemBack, useSystemBack} from "@agenta/ui/view-stack"
import {useAtom, useAtomValue, useStore, type ExtractAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {ChatLoading} from "../chat/states/ChatStates"
import {ConfigPaneLoading} from "../chat/states/ConfigPaneLoading"
import {useDriveUrlSync} from "../chat/useDriveUrlSync"

import {AgentPanelContext, type AgentPanelApi} from "./agentPanelContext"
import {AgentPanelFrame} from "./AgentPanelFrame"
import {
    agentPanelStateAtomFamily,
    nextPanelContent,
    PANEL_MIN,
    panelStateKey,
    PHONE_BELOW,
    type PanelContent,
} from "./agentPanelState"
import {useConfirmLeave} from "./LeaveGuardProvider"
import {usePanelSize} from "./usePanelSize"

// Each content loads on first use, so the session page does not carry it.
const ConfigurationContent = dynamic(
    () => import("./ConfigurationContent").then((m) => m.ConfigurationContent),
    {ssr: false, loading: ConfigPaneLoading},
)
const BuilderPanel = dynamic(() => import("../builder/BuilderPanel").then((m) => m.BuilderPanel), {
    ssr: false,
    loading: ChatLoading,
})

/** The session column a pushed panel leaves at least (the header's name, session and icons). */
const SESSION_COLUMN_MIN = 480

export interface AgentLayoutProps {
    agentId: string | null
    sessionId: string
    /** The revision the Configuration content edits. Null: no configuration (hidden agent, no agent). */
    revisionId: string | null
    /** A private agent the reader cannot see: no Configuration and no Builder. */
    agentHidden: boolean
    workspaceId: string
    projectId: string
    /** Mirror the Files selection in the URL; only where the URL names this session. */
    deepLinks: boolean
    /** The session header. It reads the panel through `useAgentPanel`. */
    header: ReactNode
    /** The conversation. It stays mounted exactly once at every width. */
    conversation: ReactNode
}

/** The body of the agent layout, below the leave guard. */
export const AgentLayoutBody = ({
    agentId,
    sessionId,
    revisionId,
    agentHidden,
    workspaceId,
    projectId,
    deepLinks,
    header,
    conversation,
}: AgentLayoutProps) => {
    const tPhone = useT(agentLayoutPhoneCatalog, agentLayoutHeaderCatalog)
    const confirmLeave = useConfirmLeave()
    const user = useAtomValue(userAtom)
    const panelKey = panelStateKey(user?.id ?? "anonymous", projectId)
    const [state, setState] = useAtom(agentPanelStateAtomFamily(panelKey))
    const phone = !useMediaQuery(`(min-width: ${PHONE_BELOW}px)`)
    // Files, Configuration and Builder share this one width, drag and widen.
    const {pushWidth, mode, width, resize, wide, setWide} = usePanelSize({
        phone,
        storedWidth: state.width,
        storeWidth: (next) => setState({width: next}),
    })
    // The widen belongs to one session: another session opens at the stored width.
    useEffect(() => setWide(false), [sessionId, setWide])

    // Files keeps its production open state and URL sync; the panel follows it.
    const filesScope = agentId ?? sessionId
    const files = useSessionFilesPane(filesScope, sessionId)
    const driveLink = useDriveUrlSync({sessionId, open: files.open, enabled: deepLinks})

    const canConfigure = Boolean(revisionId && agentId) && !agentHidden
    const available = useMemo<Record<PanelContent, boolean>>(
        () => ({
            files: true,
            configuration: canConfigure,
            builder: Boolean(agentId) && !agentHidden,
        }),
        [canConfigure, agentId, agentHidden],
    )
    // A content the screen cannot show (no configuration, no builder) stays closed.
    // Files keeps its production open state (deep links, a file card, a staged drop open it) and
    // its own close. The panel shows Files exactly while that state is open.
    const stored = state.content
    const content: PanelContent | null = files.open
        ? "files"
        : stored === "configuration" && canConfigure
          ? "configuration"
          : stored === "builder" && available.builder
            ? "builder"
            : null

    // A swap away from Files closes it, which clears what it was holding (files staged by a drop,
    // the file in quick look). They are put aside here and given back when Files opens again.
    const store = useStore()
    // Kept per session: the page stays mounted across sessions of one agent, and one session's
    // staged files must never land in another's.
    const setAside = useRef(
        new Map<
            string,
            {
                staged: ExtractAtomValue<ReturnType<typeof filesDrawerStagedAtomFamily>>
                quickLook: ExtractAtomValue<ReturnType<typeof driveQuickLookAtomFamily>>
            }
        >(),
    )
    const putAside = useCallback(() => {
        const staged = store.get(filesDrawerStagedAtomFamily(sessionId))
        const quickLook = store.get(driveQuickLookAtomFamily(sessionId))
        if (staged.length || quickLook) setAside.current.set(sessionId, {staged, quickLook})
        else setAside.current.delete(sessionId)
    }, [store, sessionId])
    const giveBack = useCallback(() => {
        const kept = setAside.current.get(sessionId)
        setAside.current.delete(sessionId)
        if (!kept) return
        // A new request that opened Files wins over what was put aside.
        if (store.get(filesDrawerStagedAtomFamily(sessionId)).length === 0)
            store.set(filesDrawerStagedAtomFamily(sessionId), kept.staged)
        if (!store.get(driveQuickLookAtomFamily(sessionId)) && kept.quickLook)
            store.set(driveQuickLookAtomFamily(sessionId), kept.quickLook)
    }, [store, sessionId])

    // These two effects run in this order (restore, then follow): the restore resets
    // `filesWasOpen`, so the follow never reads a scope change as an opening or a close.
    const filesWasOpen = useRef(files.open)
    // Files is scoped by agent, and the scope changes once the agent resolves: each new scope
    // restores again. A stored Files content opens Files after a reload.
    const restoredScope = useRef<string | null>(null)
    useEffect(() => {
        // Keyed by the stored preference too: the user can resolve after the first render.
        const restoreKey = `${panelKey}|${filesScope}`
        if (restoredScope.current === restoreKey) return
        restoredScope.current = restoreKey
        filesWasOpen.current = files.open
        if (stored === "files" && !files.open) files.openPane()
    }, [panelKey, filesScope, stored, files])

    // Files opened or closed from anywhere moves the panel with it, at the stored width.
    useEffect(() => {
        if (files.open && !filesWasOpen.current) {
            setState({content: "files"})
            setWide(false)
            giveBack()
        }
        if (!files.open && filesWasOpen.current && stored === "files") {
            setState({content: null})
            setWide(false)
        }
        filesWasOpen.current = files.open
    }, [files.open, stored, setState, setWide, giveBack])

    const setContent = useCallback(
        (next: PanelContent | null) => {
            if (next === "files") {
                if (!files.open) files.openPane()
            } else if (files.open) {
                // A swap keeps what Files held; closing the panel from Files drops it, as the
                // pane's own close does.
                if (next) putAside()
                else setAside.current.delete(sessionId)
                files.close()
            }
            setState({content: next})
            setWide(false)
        },
        [files, setState, setWide, putAside, sessionId],
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
            if (next) requestAnimationFrame(() => panelRef.current?.focus({preventScroll: true}))
            return true
        },
        [confirmLeave, content, setContent, available],
    )
    const close = useCallback(async () => {
        if (!(await confirmLeave("close"))) return false
        const was = content
        setContent(null)
        // Escape or Close at the root: focus goes back to the header icon that opened it.
        // After the commit: on a phone the header is inert until the panel closes.
        if (was)
            requestAnimationFrame(() =>
                document.getElementById(`agent-panel-icon-${was}`)?.focus({preventScroll: true}),
            )
        return true
    }, [confirmLeave, content, setContent])

    // On a phone the open panel covers the session: the browser back closes it, as its back arrow
    // does. useIsPhone, not `phone`: it stays false while hydrating, so a desktop never pushes.
    useSystemBack(useIsPhone() && content ? 1 : 0, "panel", close)
    // The panel stays open across a move to another session: its entry moves to the new page. A
    // move the leave guard stopped (the person kept editing) gets its entry back the same way.
    const router = useRouter()
    useEffect(() => {
        const onComplete = (_url: string, options?: {shallow?: boolean}) => {
            if (!options?.shallow) restartSystemBack()
        }
        const onError = (_error: unknown, _url: string, options?: {shallow?: boolean}) => {
            if (!options?.shallow) restartSystemBack()
        }
        router.events.on("routeChangeComplete", onComplete)
        router.events.on("routeChangeError", onError)
        return () => {
            router.events.off("routeChangeComplete", onComplete)
            router.events.off("routeChangeError", onError)
        }
    }, [router.events])

    // "Show me the configuration" from elsewhere (model setup, the agent overview, a new agent).
    const [revealRequest, setRevealRequest] = useAtom(configPaneRevealRequestAtom)
    useEffect(() => {
        if (revealRequest === null) return
        if (Date.now() - revealRequest > CONFIG_REVEAL_TTL_MS) {
            setRevealRequest(null)
            return
        }
        if (!canConfigure) return
        setRevealRequest(null)
        // Configuration already open on another tab: only the tab changes, nothing is left.
        if (content === "configuration") {
            setState({configTab: "agent"})
            return
        }
        void confirmLeave("swap").then((ok) => {
            if (!ok) return
            setContent("configuration")
            setState({configTab: "agent"})
            requestAnimationFrame(() => panelRef.current?.focus({preventScroll: true}))
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
        [content, toggle, close, state.configTab, setState, wide, setWide, phone, available],
    )

    // Contents stay mounted after first use (hidden), so a swap keeps their state and an upload
    // in Files is never aborted.
    const [mounted, setMounted] = useState<Set<PanelContent>>(new Set())
    useEffect(() => {
        if (content && !mounted.has(content)) setMounted(new Set(mounted).add(content))
    }, [content, mounted])

    const isFiles = content === "files"

    const panelBody = (
        <>
            {mounted.has("files") || isFiles ? (
                <div className={isFiles ? "ag-view-enter flex h-full min-h-0 flex-col" : "hidden"}>
                    {/* On a phone Files covers the session: the phone header returns to it. */}
                    {phone ? (
                        <PhoneScreenHeader
                            title={tPhone("agentLayout.header.files")}
                            backTitle={tPhone("agentLayout.phone.session")}
                            onBack={() => void close()}
                        />
                    ) : null}
                    <div className="min-h-0 flex-1">
                        <DriveLinkContext.Provider value={driveLink.copyLink}>
                            <SessionFilesPane
                                scope={filesScope}
                                sessionId={sessionId}
                                onSelectionChange={driveLink.onSelectionChange}
                                // The header icon closes it on desktop, the phone header on a
                                // phone.
                                closeControl="none"
                                // Expand is the panel's widen, as in a wide Configuration view.
                                expanded={!phone && wide}
                                // A phone has no wider pane.
                                onToggleExpand={phone ? undefined : () => setWide(!wide)}
                                readOnly={phone}
                                touch={phone}
                            />
                        </DriveLinkContext.Provider>
                    </div>
                </div>
            ) : null}
            {canConfigure && (mounted.has("configuration") || content === "configuration") ? (
                <div
                    className={content === "configuration" ? "ag-view-enter h-full min-h-0" : "hidden"}
                >
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
            {available.builder && (mounted.has("builder") || content === "builder") ? (
                <div className={content === "builder" ? "ag-view-enter h-full min-h-0" : "hidden"}>
                    {/* No page session id goes into the builder: it runs its own chat (design D6). */}
                    <BuilderPanel
                        agentId={agentId!}
                        workspaceId={workspaceId}
                        projectId={projectId}
                    />
                </div>
            ) : null}
        </>
    )

    // One tree at every width, so neither a resize nor a mode change remounts the conversation.
    const open = content !== null

    return (
        <AgentPanelContext.Provider value={api}>
            {/* The panel runs full height beside the session header (the header ends at the
                panel edge). Clipped, not scrollable: a row wider than a phone (a long header) must
                never let the browser scroll the layout sideways, which shifts a full screen panel
                off its left edge when focus moves into it. */}
            <div className="relative flex h-full min-h-0 overflow-x-clip">
                <div
                    className="ag-canvas flex h-full min-h-0 min-w-0 flex-1 flex-col"
                    // A pushed panel stops short of this column (a wide panel at 1100 px), so the
                    // session header keeps the agent name, the session and its icons. Never more
                    // than the room the panel's own minimum leaves, so nothing is clipped.
                    style={
                        mode === "push" && open
                            ? {
                                  minWidth: `min(${SESSION_COLUMN_MIN}px, calc(100% - ${PANEL_MIN}px))`,
                              }
                            : undefined
                    }
                    inert={mode === "full" && open}
                >
                    {header}
                    <div
                        className={cn(
                            "flex min-h-0 min-w-0 flex-1 flex-col",
                            mode === "full" && open && "hidden",
                        )}
                    >
                        {conversation}
                    </div>
                </div>
                <AgentPanelFrame
                    open={open}
                    mode={mode}
                    width={width}
                    resize={resize}
                    // Under 1100 px the panel lies over the conversation, below the session
                    // header: the header icons that swap the panel stay in reach.
                    overlayTop={pushWidth ? undefined : "top-12"}
                    panelRef={panelRef}
                    onClose={() => void close()}
                >
                    {panelBody}
                </AgentPanelFrame>
            </div>
        </AgentPanelContext.Provider>
    )
}
