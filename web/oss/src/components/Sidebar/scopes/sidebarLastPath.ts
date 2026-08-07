interface SidebarViewReturnTarget {
    id: string
    isBase?: boolean
}

export const resolveSidebarLastPath = ({
    view,
    lastNonSettingsPath,
    fallbackPath,
}: {
    view: SidebarViewReturnTarget
    lastNonSettingsPath: string | null
    fallbackPath: string
}): string | null => {
    if (view.isBase) return null
    return lastNonSettingsPath || fallbackPath
}
