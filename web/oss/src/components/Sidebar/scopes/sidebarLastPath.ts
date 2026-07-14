import {SETTINGS_SIDEBAR_SCOPE_ID} from "./constants"

interface SidebarViewReturnTarget {
    id: string
    isBase?: boolean
}

export const resolveSidebarLastPath = ({
    view,
    lastBasePath,
    lastNonSettingsPath,
    fallbackPath,
}: {
    view: SidebarViewReturnTarget
    lastBasePath: string | null
    lastNonSettingsPath: string | null
    fallbackPath: string
}): string | null => {
    if (view.isBase) return null
    if (view.id === SETTINGS_SIDEBAR_SCOPE_ID) return lastNonSettingsPath || fallbackPath
    return lastBasePath || fallbackPath
}
