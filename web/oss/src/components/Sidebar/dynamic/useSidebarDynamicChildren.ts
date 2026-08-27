import {useEffect} from "react"

import {
    injectDynamicChildren,
    localSessionRefsAtom,
    resolveChildren,
    useSidebarDynamicChildren as useSharedSidebarDynamicChildren,
    type SidebarConfig,
} from "@agenta/navigation"
import {useAtomValue, useSetAtom} from "jotai"

import {getEntityKindIcon} from "@/oss/components/References"
import useURL from "@/oss/hooks/useURL"

import {localPlaygroundSessionRefsAtom} from "./localSessionRefs"
import {useSessionRowWrappers} from "./sessionRowWrapper"

export {injectDynamicChildren, resolveChildren}

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
    })
}
