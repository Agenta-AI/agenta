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
import {AgentPanelFrame} from "./AgentPanelFrame"
import {
    agentPanelStateAtomFamily,
    panelStateKey,
    PHONE_BELOW,
    type PanelContent,
} from "./agentPanelState"
import {usePanelSize} from "./usePanelSize"

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
    const {pushWidth, mode, width, resize, wide, setWide} = usePanelSize({
        phone,
        storedWidth: state.width,
        storeWidth: (next) => setState({width: next}),
    })
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
    }, [open, setState, setWide])
    const close = useCallback(async () => {
        setState({content: null})
        setWide(false)
        return true
    }, [setState, setWide])
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
        [open, toggle, close, state.configTab, setState, wide, setWide, phone],
    )
    const openBuilder = useCallback(() => void toggle(), [toggle])

    return (
        <AgentPageBuilderContext.Provider value={openBuilder}>
            <AgentPanelContext.Provider value={api}>
                <div className="relative flex h-[calc(var(--ag-viewport-height,100dvh)-var(--ag-top-bars-h,0px))] min-h-0 overflow-x-clip">
                    <div className="min-w-0 flex-1" inert={mode === "full" && open}>
                        {children}
                    </div>
                    <AgentPanelFrame
                        open={open}
                        present={open}
                        mode={mode}
                        width={width}
                        resize={resize}
                        // Under 1100 px the panel lies over the page below the row with Builder:
                        // the compact bar, or from lg the title row.
                        overlayTop={pushWidth ? undefined : "top-12 lg:top-16"}
                        panelRef={panelRef}
                        onClose={() => void close()}
                    >
                        {/* No builder code loads on a page that never opens it. */}
                        {used ? (
                            <BuilderPanel
                                agentId={agentId}
                                workspaceId={workspaceId}
                                projectId={projectId}
                            />
                        ) : null}
                    </AgentPanelFrame>
                </div>
            </AgentPanelContext.Provider>
        </AgentPageBuilderContext.Provider>
    )
}
