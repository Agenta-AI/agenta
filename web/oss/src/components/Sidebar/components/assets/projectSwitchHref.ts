interface BuildProjectSwitchHrefParams {
    workspaceId: string
    projectId: string
    currentAsPath: string
    settingsTab?: string
    queryTab?: string
}

/**
 * Builds the target URL when switching to a different project.
 *
 * Only the top-level section (e.g. "apps", "evaluations") is preserved. Nested
 * entity IDs — an evaluation, app, testset, etc. — belong to the previous
 * project and don't exist in the target project, so keeping them in the URL
 * would land the user on an empty screen. The settings tab query param is the
 * one exception that carries over, since tabs exist across all projects.
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
    const currentTab =
        (settingsTab && settingsTab !== "workspace" ? settingsTab : undefined) ?? queryTab
    const tabParam = isOnSettingsPage && currentTab ? `?tab=${encodeURIComponent(currentTab)}` : ""

    return `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/${currentPagePath}${tabParam}`
}
