interface BuildProjectSwitchHrefParams {
    workspaceId: string
    projectId: string
    currentAsPath: string
    settingsTab?: string
    queryTab?: string | string[]
}

/**
 * Builds the target URL when switching to a different project/workspace context.
 *
 * Only the top-level section is preserved. Nested entity IDs belong to the previous
 * context, so keeping them in the URL would land the user on stale entity routes.
 * The settings tab query param is the one exception that carries over.
 */
export function buildProjectSwitchHref({
    workspaceId,
    projectId,
    currentAsPath,
    settingsTab,
    queryTab,
}: BuildProjectSwitchHrefParams): string {
    const currentPathMatch = currentAsPath.match(/\/p\/[^/]+\/([^/?#]+)/)
    const currentPagePath = currentPathMatch?.[1] ?? "apps"

    const isOnSettingsPage = currentPagePath.startsWith("settings")
    const normalizedQueryTab = Array.isArray(queryTab) ? queryTab[0] : queryTab
    const currentTab =
        (settingsTab && settingsTab !== "workspace" ? settingsTab : undefined) ?? normalizedQueryTab
    const tabParam = isOnSettingsPage && currentTab ? `?tab=${encodeURIComponent(currentTab)}` : ""

    return `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/${currentPagePath}${tabParam}`
}
