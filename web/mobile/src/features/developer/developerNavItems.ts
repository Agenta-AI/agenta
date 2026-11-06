import {createElement} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {
    CodeIcon,
    DatabaseIcon,
    FlaskIcon,
    GavelIcon,
    LightningIcon,
    ListChecksIcon,
    SquaresFourIcon,
    type Icon,
} from "@phosphor-icons/react"

import type {DeveloperNavSection, DeveloperView} from "./developerViews"

const SECTION_TITLES: Record<DeveloperNavSection, string> = {developer: "Developer"}

/** The rail key of a developer view's row. The Prompts row's key is also read by the selection. */
export const developerRowKey = (viewId: string) => `developer-view-${viewId}`

/**
 * One rail section per nav section that has an enabled view, or nothing at all. Links do not
 * prefetch when they scroll into view: a developer view's code must not load on the pages every
 * user opens.
 *
 * The rail without beta developer mode. Beta developer mode uses `developerRailItems` instead.
 */
export const developerNavItems = (
    projectURL: string,
    views: readonly DeveloperView[],
): SidebarConfig[] =>
    (Object.keys(SECTION_TITLES) as DeveloperNavSection[]).flatMap((section) => {
        const rows = views.flatMap(({id, label, routes, nav}) =>
            routes && nav?.section === section ? [{id, label, path: routes[0], nav}] : [],
        )
        if (rows.length === 0) return []
        return [
            {
                key: `developer-section-${section}`,
                title: SECTION_TITLES[section],
                icon: createElement(CodeIcon, {size: 16}),
                // A section, not a fold: no caret, and no persisted open state to start closed.
                alwaysOpen: true,
                submenu: rows.map(({id, label, path, nav}) => ({
                    key: developerRowKey(id),
                    title: label,
                    icon: createElement(nav.icon, {size: 16}),
                    link: `${projectURL}${path}`,
                    prefetch: false,
                })),
            },
        ]
    })

/** Where a developer view sits in the beta developer mode rail. */
type DeveloperRailPlacement = "lead" | "evaluation" | "trail"

interface DeveloperRailRow {
    viewId: string
    title: string
    icon: Icon
    placement: DeveloperRailPlacement
}

/**
 * The developer rows of the old app's rail, in its order, with its labels and icons. Prompts
 * leads; the Evaluation group holds Test sets, Evaluators, Evaluation runs and Annotation Queues.
 * Endpoints and Archived apps get no row, as in the old app: Archived apps is a link on the
 * Prompts page, and Endpoints opens from an app. Registry trails the rail until the app menu
 * gives it a place inside an app.
 */
const DEVELOPER_RAIL_ROWS: readonly DeveloperRailRow[] = [
    {viewId: "prompts", title: "Prompts", icon: SquaresFourIcon, placement: "lead"},
    {viewId: "testsets", title: "Test sets", icon: DatabaseIcon, placement: "evaluation"},
    {viewId: "evaluators", title: "Evaluators", icon: GavelIcon, placement: "evaluation"},
    {viewId: "evaluations", title: "Evaluation runs", icon: FlaskIcon, placement: "evaluation"},
    {
        viewId: "annotation-queues",
        title: "Annotation Queues",
        icon: ListChecksIcon,
        placement: "evaluation",
    },
    {viewId: "variants", title: "Registry", icon: LightningIcon, placement: "trail"},
]

export interface DeveloperRail {
    /** Rows right after Home: Prompts. */
    lead: SidebarConfig[]
    /** The Evaluation group, after Sessions. */
    evaluation: SidebarConfig[]
    /** Rows after Observability: Registry. */
    trail: SidebarConfig[]
}

/**
 * The developer rows in beta developer mode, laid out like the old app's rail. Only enabled
 * views with a route get a row; an empty group is left out.
 */
export const developerRailItems = (
    projectURL: string,
    views: readonly DeveloperView[],
): DeveloperRail => {
    const rowsAt = (placement: DeveloperRailPlacement): SidebarConfig[] =>
        DEVELOPER_RAIL_ROWS.flatMap((row) => {
            const view = views.find(({id}) => id === row.viewId)
            if (row.placement !== placement || !view?.routes) return []
            return [
                {
                    key: developerRowKey(row.viewId),
                    title: row.title,
                    icon: createElement(row.icon, {size: 16}),
                    link: `${projectURL}${view.routes[0]}`,
                    prefetch: false,
                },
            ]
        })
    const evaluationRows = rowsAt("evaluation")

    return {
        lead: rowsAt("lead"),
        evaluation: evaluationRows.length
            ? [
                  {
                      key: "developer-evaluation",
                      title: "Evaluation",
                      icon: createElement(FlaskIcon, {size: 16}),
                      submenu: evaluationRows,
                  },
              ]
            : [],
        trail: rowsAt("trail"),
    }
}
