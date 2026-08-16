import {
    injectDynamicChildren,
    resolveChildren,
    useSidebarDynamicChildren as useSharedSidebarDynamicChildren,
    type SidebarConfig,
} from "@agenta/navigation"

import {getEntityKindIcon} from "@/oss/components/References"
import useURL from "@/oss/hooks/useURL"

export {injectDynamicChildren, resolveChildren}

/** The oss binding: same hook, with the app's URL base and reference icon set injected. */
export const useSidebarDynamicChildren = (): Record<string, SidebarConfig[]> => {
    const {projectURL} = useURL()
    return useSharedSidebarDynamicChildren({projectURL, kindIcon: getEntityKindIcon})
}
