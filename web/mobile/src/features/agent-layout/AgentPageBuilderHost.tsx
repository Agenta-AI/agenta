import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react"

import {userAtom} from "@agenta/shared/state"
import {useMediaQuery} from "@agenta/ui/hooks"
import {useIsPhone} from "@agenta/ui/phone"
import {useSystemBack} from "@agenta/ui/view-stack"
import {useAtom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {ChatLoading} from "../chat/states/ChatStates"

import {AgentPanelContext, type AgentPanelApi} from "./agentPanelContext"
import {AgentPanelFrame, type PanelMode} from "./AgentPanelFrame"
import {
    agentPanelStateAtomFamily,
    OVERLAY_BELOW,
    PANEL_MAX,
    PANEL_MIN,
    PANEL_WIDE,
    panelStateKey,
    PHONE_BELOW,
    type PanelContent,
} from "./agentPanelState"

const BuilderPanel = dynamic(() => import("../builder/BuilderPanel").then((m) => m.BuilderPanel), {
    ssr: false,
    loading: ChatLoading,
})

/** Builder only: an agent page has no Files and no Configuration panel. */
const AVAILABLE: Record<PanelContent, boolean> = {
    files: false,
    configuration: false,
    builder: true,
}

/** Opens or closes the builder panel of the agent page around it; null outside one. */
const AgentPageBuilderContext = createContext<(() => void) | null>(null)

/** The Builder icon's action on an agent page. Null outside the host: no icon there. */
export const useOpenAgentBuilder = () => useContext(AgentPageBuilderContext)

/**
 * The right panel of the agent pages (Configuration, Sessions, Channels, Analytics): the builder
 * of this agent, full height beside the page. It reads and writes the same stored panel state as
 * the session screen, so a builder opened in a session is open here, and the other way round.
 */
export const AgentPageBuilderHost = ({
    agentId,
    workspaceId,
    projectId,
    children,
}: {
    agentId: string
    workspaceId: string
    projectId: string
    /** The page, with its own `AppShell`. */
    children: ReactNode
}) => {
    const user = useAtomValue(userAtom)
    const [state, setState] = useAtom(
        agentPanelStateAtomFamily(panelStateKey(user?.id ?? "anonymous", projectId)),
    )
    const phone = !useMediaQuery(`(min-width: ${PHONE_BELOW}px)`)
    const pushWidth = useMediaQuery(`(min-width: ${OVERLAY_BELOW}px)`)
    const [wide, setWide] = useState(false)
    const [liveWidth, setLiveWidth] = useState<number | null>(null)
    const open = state.content === "builder"
    // Mounted from the first open on and kept while closed, so a close keeps the chat's state.
    const [used, setUsed] = useState(open)
    if (open && !used) setUsed(true)

    const panelRef = useRef<HTMLDivElement>(null)
    const toggle = useCallback(async () => {
        const next = open ? null : "builder"
        setState({content: next})
        setWide(false)
        if (next) requestAnimationFrame(() => panelRef.current?.focus({preventScroll: true}))
        return true
    }, [open, setState])
    const close = useCallback(async () => {
        setState({content: null})
        setWide(false)
        return true
    }, [setState])
    // On a phone the panel covers the page: the browser back closes it, as its back arrow does.
    useSystemBack(useIsPhone() && open ? 1 : 0, "panel", close)

    const api = useMemo<AgentPanelApi>(
        () => ({
            content: open ? "builder" : null,
            toggle: async (content) => (content === "builder" ? toggle() : false),
            close,
            configTab: state.configTab,
            setConfigTab: (configTab) => setState({configTab}),
            wide,
            setWide,
            phone,
            available: AVAILABLE,
        }),
        [open, toggle, close, state.configTab, setState, wide, phone],
    )
    const openBuilder = useCallback(() => void toggle(), [toggle])

    const mode: PanelMode = phone ? "full" : !pushWidth || wide ? "overlay" : "push"
    const width = wide ? PANEL_WIDE : (liveWidth ?? state.width)

    return (
        <AgentPageBuilderContext.Provider value={openBuilder}>
            <AgentPanelContext.Provider value={api}>
                <div className="relative flex h-[calc(var(--ag-viewport-height,100dvh)-var(--ag-top-bars-h,0px))] min-h-0 overflow-x-clip">
                    <div className="min-w-0 flex-1" inert={mode === "full" && open}>
                        {children}
                    </div>
                    <AgentPanelFrame
                        open={open}
                        mode={mode}
                        width={width}
                        resize={
                            wide
                                ? null
                                : {
                                      min: PANEL_MIN,
                                      max: PANEL_MAX,
                                      onLive: setLiveWidth,
                                      onCommit: (next) => {
                                          setLiveWidth(null)
                                          setState({width: next})
                                      },
                                  }
                        }
                    >
                        <div
                            ref={panelRef}
                            tabIndex={-1}
                            data-testid="agent-panel"
                            className="ag-panel-raised flex h-full min-h-0 w-full flex-col outline-none"
                            onKeyDown={(event) => {
                                // A menu or dialog closes itself; what is left closes the panel.
                                if (event.key !== "Escape" || event.defaultPrevented) return
                                const layer = (event.target as HTMLElement).closest?.(
                                    '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
                                )
                                if (layer && layer !== event.currentTarget) return
                                event.preventDefault()
                                void close()
                            }}
                        >
                            {/* No builder code loads on a page that never opens it. */}
                            {used ? (
                                <BuilderPanel
                                    agentId={agentId}
                                    workspaceId={workspaceId}
                                    projectId={projectId}
                                />
                            ) : null}
                        </div>
                    </AgentPanelFrame>
                </div>
            </AgentPanelContext.Provider>
        </AgentPageBuilderContext.Provider>
    )
}
