import {useEffect} from "react"

import {AgentGlyph} from "@agenta/entity-ui/agent"
import {
    AGENTS_SIDEBAR_KEY,
    injectDynamicChildren,
    localSessionRefsAtom,
    resolveChildren,
    useSidebarDynamicChildren as useSharedSidebarDynamicChildren,
    type SidebarConfig,
    type SidebarRowIcons,
} from "@agenta/navigation"
import {RobotIcon} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {getEntityKindIcon} from "@/oss/components/References"
import useURL from "@/oss/hooks/useURL"

import {localPlaygroundSessionRefsAtom} from "./localSessionRefs"
import {useSessionRowWrappers} from "./sessionRowWrapper"

export {injectDynamicChildren, resolveChildren}

/** Rendering lives in the app shell: @agenta/navigation is headless and only calls this. */
const ROW_ICONS: SidebarRowIcons = {
    [AGENTS_SIDEBAR_KEY]: (workflow) => (
        <AgentGlyph workflowId={workflow.id} size={14} fallback={<RobotIcon size={14} />} />
    ),
}

/** The oss binding: same hook, with the app's URL base and reference icon set injected. */
export const useSidebarDynamicChildren = (): Record<string, SidebarConfig[]> => {
    const {projectURL} = useURL()
    // Feed the package's local-session seam (#5974): client-created sessions the server list
    // cannot carry yet, so a running first turn keeps its row and spinner across tab switches.
    const localRefs = useAtomValue(localPlaygroundSessionRefsAtom)
    const setLocalRefs = useSetAtom(localSessionRefsAtom)
    useEffect(() => {
        setLocalRefs(localRefs)
    }, [localRefs, setLocalRefs])
    const rowWrappers = useSessionRowWrappers()
    return useSharedSidebarDynamicChildren({
        projectURL,
        kindIcon: getEntityKindIcon,
        rowWrappers,
        rowIcons: ROW_ICONS,
    })
}
