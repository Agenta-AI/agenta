import {BreadcrumbAtom} from "@/oss/lib/atoms/breadcrumb"
import {isUuid} from "@/oss/lib/helpers/utils"
import {ListAppsItem} from "@/oss/lib/Types"

const IGNORE_PATHS = new Set(["testsets", "evaluations", "settings"])

/**
 * Generates breadcrumb segments from a URI path, specifically handling app-related navigation.
 * Creates a hierarchical structure of breadcrumb items with proper navigation links.
 *
 * @param {string} uriPath - The current URI path (e.g., '/apps/123/overview')
 * @param {ListAppsItem[]} apps - List of application items to generate navigation for
 * @returns {BreadcrumbAtom} A structured object representing the breadcrumb hierarchy
 *
 * @example
 * // Returns { apps: { label: 'Apps' }, app: { label: 'My App', href: '/apps/123/overview' } }
 * generateSegmentsForBreadcrumb({
 *   uriPath: '/apps/123/overview',
 *   apps: [{ app_id: '123', app_name: 'My App' }]
 * });
 */
export const generateSegmentsForBreadcrumb = ({
    uriPath,
    apps,
}: {
    uriPath: string
    apps: ListAppsItem[]
}): BreadcrumbAtom => {
    const items: BreadcrumbAtom = {}
    const segments = uriPath.split("?")[0].split("/").filter(Boolean)
    const appSlugIndex = segments.indexOf("apps")

    if (appSlugIndex !== -1) {
        const appId = segments[appSlugIndex + 1]

        items["apps"] = {label: "Apps", href: "/apps"}

        const slicedSegments = segments.slice(appSlugIndex + 2)

        if (appId) {
            const app = apps.find((app) => app.app_id === appId)

            items["app"] = {
                label: app?.app_name!,
                href: `/apps/${appId}/overview`,
            }
        }

        let cumulative = `/apps/${appId}`

        for (let i = 0; i < slicedSegments.length; i++) {
            const seg = slicedSegments[i]

            if (IGNORE_PATHS.has(seg) || isUuid(seg)) {
                break
            }

            cumulative += `/${seg}`
            items["appPage"] = {
                label: seg,
                ...(i === slicedSegments.length ? {href: cumulative} : {}),
            }
        }
    } else {
        let cumulative = ""
        segments.forEach((seg) => {
            cumulative += `/${seg}`
            if (IGNORE_PATHS.has(seg) || isUuid(seg)) {
                return
            }
            items[seg] = {label: seg, ...(segments.length === 1 ? {} : {href: cumulative})}
        })
    }

    return items
}
