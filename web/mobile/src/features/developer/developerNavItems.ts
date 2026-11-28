import {createElement} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {
    ChatCircleIcon,
    CodeIcon,
    DatabaseIcon,
    FlaskIcon,
    GavelIcon,
    ListChecksIcon,
    type Icon,
} from "@phosphor-icons/react"

import {tNow, type NavTranslate} from "../nav/observabilityNavItems"

import type {DeveloperNavSection, DeveloperView} from "./developerViews"

const SECTION_TITLES: Record<DeveloperNavSection, NavKey> = {
    developer: "navigation.items.developer",
}

type NavKey = Parameters<NavTranslate>[0]

/** The rail label of the views the navigation catalog names; any other view shows its `label`. */
const VIEW_TITLES: Partial<Record<string, NavKey>> = {
    prompts: "navigation.items.prompts",
    testsets: "navigation.items.testSets",
    evaluators: "navigation.items.evaluators",
    "annotation-queues": "navigation.items.annotationQueues",
}

/** The rail key of a developer view's row. The Prompts row's key is also read by the selection. */
export const developerRowKey = (viewId: string) => `developer-view-${viewId}`

/**
 * One rail section per nav section that has an enabled view, or nothing at all. Links do not
 * prefetch when they scroll into view: a developer view's code must not load on the pages every
 * user opens.
 * Without beta developer mode only; beta uses `developerRailItems`.
 */
export const developerNavItems = (
    projectURL: string,
    views: readonly DeveloperView[],
    t: NavTranslate = tNow,
): SidebarConfig[] =>
    (Object.keys(SECTION_TITLES) as DeveloperNavSection[]).flatMap((section) => {
        const rows = views.flatMap(({id, label, routes, nav}) =>
            routes && nav?.section === section ? [{id, label, path: routes[0], nav}] : [],
        )
        if (rows.length === 0) return []
        return [
            {
                key: `developer-section-${section}`,
                title: t(SECTION_TITLES[section]),
                icon: createElement(CodeIcon, {size: 16}),
                // A section, not a fold: no caret, and no persisted open state to start closed.
                alwaysOpen: true,
                submenu: rows.map(({id, label, path, nav}) => {
                    const titleKey = VIEW_TITLES[id]
                    return {
                        key: developerRowKey(id),
                        title: titleKey ? t(titleKey) : label,
                        icon: createElement(nav.icon, {size: 16}),
                        link: `${projectURL}${path}`,
                        prefetch: false,
                    }
                }),
            },
        ]
    })

/** Where a developer view sits in the beta developer mode rail. */
type DeveloperRailPlacement = "lead" | "evaluation"

interface DeveloperRailRow {
    viewId: string
    title: NavKey
    icon: Icon
    placement: DeveloperRailPlacement
}

/** The old app's developer rows, labels and icons; no Endpoints or Archived apps row (D7). */
const DEVELOPER_RAIL_ROWS: readonly DeveloperRailRow[] = [
    {
        viewId: "prompts",
        title: "navigation.items.prompts",
        // Not SquaresFour: Templates has it.
        icon: ChatCircleIcon,
        placement: "lead",
    },
    {
        viewId: "testsets",
        title: "navigation.items.testSets",
        icon: DatabaseIcon,
        placement: "evaluation",
    },
    {
        viewId: "evaluators",
        title: "navigation.items.evaluators",
        icon: GavelIcon,
        placement: "evaluation",
    },
    {
        viewId: "evaluations",
        title: "navigation.items.evaluationRuns",
        icon: FlaskIcon,
        placement: "evaluation",
    },
    {
        viewId: "annotation-queues",
        title: "navigation.items.annotationQueues",
        icon: ListChecksIcon,
        placement: "evaluation",
    },
]

export interface DeveloperRail {
    /** Rows right after Home: Prompts. */
    lead: SidebarConfig[]
    /** The Evaluation group, after Sessions. */
    evaluation: SidebarConfig[]
}

/** The beta developer mode rows, from enabled views only; an empty group is left out. */
export const developerRailItems = (
    projectURL: string,
    views: readonly DeveloperView[],
    t: NavTranslate = tNow,
): DeveloperRail => {
    const rowsAt = (placement: DeveloperRailPlacement): SidebarConfig[] =>
        DEVELOPER_RAIL_ROWS.flatMap((row) => {
            const view = views.find(({id}) => id === row.viewId)
            if (row.placement !== placement || !view?.routes) return []
            return [
                {
                    key: developerRowKey(row.viewId),
                    title: t(row.title),
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
                      title: t("navigation.items.evaluation"),
                      icon: createElement(FlaskIcon, {size: 16}),
                      submenu: evaluationRows,
                  },
              ]
            : [],
    }
}
