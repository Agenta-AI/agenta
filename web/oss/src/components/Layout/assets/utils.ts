import {BreadcrumbAtom} from "@/oss/lib/atoms/breadcrumb"
import {isUuid} from "@/oss/lib/helpers/utils"
import {ListAppsItem} from "@/oss/lib/Types"

const IGNORE_PATHS = new Set(["testsets", "evaluations", "settings"])

/**
 * Generates breadcrumb segments from a URI path, specifically handling app-related navigation.
 * Creates a hierarchical structure of breadcrumb items with proper navigation links.
 *
 * @param {string} uriPath - The current URI path (e.g., '/w/<ws>/p/<project>/apps/123/overview')
 * @param {ListAppsItem[]} apps - List of application items to generate navigation for
 * @returns {BreadcrumbAtom} A structured object representing the breadcrumb hierarchy
 *
 * @example
 * // Returns { apps: { label: 'Apps' }, app: { label: 'My App', href: '/w/<ws>/p/<project>/apps/123/overview' } }
 * generateSegmentsForBreadcrumb({
 *   uriPath: '/w/<ws>/p/<project>/apps/123/overview',
 *   apps: [{ app_id: '123', app_name: 'My App' }]
 * });
 */
export const generateSegmentsForBreadcrumb = ({
    uriPath,
    apps,
    workspaceId,
    workspaceName,
    projectId,
    projectName,
    projectIsPending,
}: {
    uriPath: string
    apps: ListAppsItem[]
    workspaceId: string | null
    workspaceName: string
    projectId: string | null
    projectName?: string | null
    projectIsPending?: boolean
}): BreadcrumbAtom => {
    const items: BreadcrumbAtom = {}
    const segments = uriPath.split("?")[0].split("/").filter(Boolean)
    const appSlugIndex = segments.indexOf("apps")

    const wsIndex = segments.indexOf("w")
    const projectIndex = segments.indexOf("p")

    // Resolve IDs from URL if atoms are not yet ready (deep-link friendly)
    const workspaceIdFromPath = wsIndex !== -1 ? segments[wsIndex + 1] : null
    const projectIdFromPath = projectIndex !== -1 ? segments[projectIndex + 1] : null
    const resolvedWorkspaceId = workspaceId || workspaceIdFromPath
    const resolvedProjectId = projectId || projectIdFromPath

    if (wsIndex !== -1) {
        const hasWorkspaceId = Boolean(resolvedWorkspaceId)
        // Do not show UUID fallback; use a generic placeholder until name is known
        const wsLabel = workspaceName || "Workspace"
        const wsHref = hasWorkspaceId ? `/w/${encodeURIComponent(resolvedWorkspaceId!)}` : undefined
        items["workspace"] = {label: wsLabel, ...(wsHref ? {href: wsHref} : {})}
    }

    if (projectIndex !== -1 && resolvedProjectId) {
        // Do not show UUID fallback; use a generic placeholder until name is known
        const projectLabel = projectName || (projectIsPending ? "Loading project..." : "Project")
        const projectHref = resolvedWorkspaceId
            ? `/w/${encodeURIComponent(resolvedWorkspaceId)}/p/${encodeURIComponent(resolvedProjectId)}/apps`
            : `/p/${encodeURIComponent(resolvedProjectId)}/apps`
        items["project"] = {label: projectLabel, href: projectHref}
    }

    if (appSlugIndex !== -1) {
        const appId = segments[appSlugIndex + 1]
        const baseAppsPath =
            resolvedWorkspaceId && resolvedProjectId
                ? `/w/${encodeURIComponent(resolvedWorkspaceId)}/p/${encodeURIComponent(resolvedProjectId)}/apps`
                : `/${segments.slice(0, appSlugIndex + 1).join("/")}`

        items["apps"] = {label: "Apps", href: baseAppsPath}

        const slicedSegments = segments.slice(appSlugIndex + 2)

        if (appId) {
            const app = apps.find((appItem) => appItem.app_id === appId)

            items["app"] = {
                // Avoid showing raw appId; use placeholder until name loads
                label: app?.app_name ?? "App",
                href: `${baseAppsPath}/${appId}/overview`,
            }
        }

        let cumulative = `${baseAppsPath}/${appId}`

        // Unified handling: map evaluations[/results] to a single friendly crumb,
        // and collapse UUID + name into one detail crumb when possible.
        for (let i = 0; i < slicedSegments.length; i++) {
            const seg = slicedSegments[i]
            const next = slicedSegments[i + 1]

            if (seg === "evaluations") {
                const hasResults = next === "results"
                // 'auto evaluation' should link to the evaluations list (not results)
                const evaluationsHref = `${baseAppsPath}/${appId}/evaluations`
                items["appPage"] = {label: "auto evaluation", href: evaluationsHref}

                // Build detail hrefs off the concrete results path when present
                if (hasResults) {
                    // consume 'results'
                    i++
                    const idSeg = slicedSegments[i + 1]
                    const nameSeg = slicedSegments[i + 2]
                    if (idSeg && isUuid(idSeg)) {
                        if (nameSeg && !isUuid(nameSeg)) {
                            const detailHref = `${baseAppsPath}/${appId}/evaluations/results/${idSeg}/${nameSeg}`
                            items["appPageDetail"] = {label: nameSeg, href: detailHref}
                        } else {
                            // If only an ID is present and no human-readable name yet, skip adding a crumb
                        }
                    }
                }
                break
            }

            // Collapse id + name pairs
            if (isUuid(seg)) {
                if (next && !isUuid(next)) {
                    cumulative += `/${seg}/${next}`
                    const isLastPair = i + 1 === slicedSegments.length - 1
                    items["appPageDetail"] = {
                        label: next,
                        ...(isLastPair ? {href: cumulative} : {}),
                    }
                    i++
                    continue
                }
                break
            }

            // Generic segment as a page crumb
            cumulative += `/${seg}`
            const isLast = i === slicedSegments.length - 1
            items["appPage"] = {
                label: seg,
                ...(isLast ? {href: cumulative} : {}),
            }
        }
    } else {
        let cumulative = ""
        segments.forEach((seg) => {
            cumulative += `/${seg}`
            if (IGNORE_PATHS.has(seg) || isUuid(seg) || seg === "w" || seg === "p") {
                return
            }
            items[seg] = {label: seg, ...(segments.length === 1 ? {} : {href: cumulative})}
        })
    }

    return items
}
