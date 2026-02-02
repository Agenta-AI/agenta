import {BreadcrumbAtom} from "@/oss/lib/atoms/breadcrumb/types"
import {isUuid} from "@/oss/lib/helpers/utils"
import {ListAppsItem} from "@/oss/lib/Types"

const IGNORE_PATHS = new Set(["testsets", "evaluations", "settings", "configure", "results"])

export interface BreadcrumbContext {
    uriPath: string
    apps: ListAppsItem[]
    workspaceId: string | null
    workspaceName: string
    projectId: string | null
    projectName?: string | null
    projectIsPending?: boolean
}

export const buildBreadcrumbSegments = ({
    uriPath,
    apps,
    workspaceId,
    workspaceName,
    projectId,
    projectName,
    projectIsPending,
}: BreadcrumbContext): BreadcrumbAtom => {
    const items: BreadcrumbAtom = {}
    // Remove query params and hash from path before splitting into segments
    const segments = uriPath.split("?")[0].split("#")[0].split("/").filter(Boolean)
    const appSlugIndex = segments.indexOf("apps")

    const wsIndex = segments.indexOf("w")
    const projectIndex = segments.indexOf("p")

    const workspaceIdFromPath = wsIndex !== -1 ? segments[wsIndex + 1] : null
    const projectIdFromPath = projectIndex !== -1 ? segments[projectIndex + 1] : null
    const resolvedWorkspaceId = workspaceId || workspaceIdFromPath
    const resolvedProjectId = projectId || projectIdFromPath

    if (wsIndex !== -1) {
        const hasWorkspaceId = Boolean(resolvedWorkspaceId)
        const wsLabel = workspaceName || "Workspace"
        const wsHref = hasWorkspaceId ? `/w/${encodeURIComponent(resolvedWorkspaceId!)}` : undefined
        items["workspace"] = {label: wsLabel, ...(wsHref ? {href: wsHref} : {})}
    }

    if (projectIndex !== -1 && resolvedProjectId) {
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
                label: app?.app_name ?? "App",
                href: `${baseAppsPath}/${appId}/overview`,
            }
        }

        let cumulative = `${baseAppsPath}/${appId}`

        for (let i = 0; i < slicedSegments.length; i++) {
            const seg = slicedSegments[i]
            const next = slicedSegments[i + 1]

            if (seg === "evaluations") {
                const hasResults = next === "results"
                const evaluationsHref = `${baseAppsPath}/${appId}/evaluations`
                items["appPage"] = {label: "auto evaluation", href: evaluationsHref}

                if (hasResults) {
                    i++
                    const idSeg = slicedSegments[i + 1]
                    const nameSeg = slicedSegments[i + 2]
                    if (idSeg && isUuid(idSeg)) {
                        if (nameSeg && !isUuid(nameSeg)) {
                            const detailHref = `${baseAppsPath}/${appId}/evaluations/results/${idSeg}/${nameSeg}`
                            items["appPageDetail"] = {label: nameSeg, href: detailHref}
                        }
                    }
                }
                break
            }

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
