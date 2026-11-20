import {
    Archive,
    Plugs as PlugsIcon,
    type Icon,
    Tray,
    TableIcon,
    GitBranchIcon,
    FolderSimpleIcon,
    ChartDonut,
    ChartBar,
} from "@phosphor-icons/react"

/** The nav group a developer view's link sits in. */
export type DeveloperNavSection = "developer"

export interface DeveloperViewNav {
    icon: Icon
    section: DeveloperNavSection
}

/**
 * A rebuilt view. Most are pages: they have `routes` and usually a `nav` link. A view with no
 * routes is a feature gate on a shared screen (an action, a filter): the screen asks
 * `useDeveloperViewEnabled(id)` and it gets no nav link.
 */
export interface DeveloperView {
    /** Lowercase, kebab-case. Names the view in the env override. */
    id: string
    /** The view's name, shown on its rail link. */
    label: string
    /**
     * Next route patterns, relative to the project (`/w/[workspace_id]/p/[project_id]`), for
     * example `/testsets` and `/testsets/[testset_id]`. The first one is the nav link, so it
     * must have no params.
     */
    routes?: readonly [string, ...string[]]
    /** The rail link to `routes[0]`, titled `label`. Ignored on a view with no routes. */
    nav?: DeveloperViewNav
}

/**
 * Every developer view /m has, rebuilt from the old app one at a time.
 *
 * Only beta developer mode shows them, unless a deployment forces a view on for everyone: see
 * `enabledDeveloperViewsAtom` and `readForcedDeveloperViewIds`. Keep this file free of view code:
 * a view's screen loads only from its own route page, so listing it here adds nothing to the
 * pages every user opens.
 */
export const DEVELOPER_VIEWS: readonly DeveloperView[] = [
    {
        id: "archived-apps",
        label: "Archived apps",
        routes: ["/apps/archived"],
        nav: {icon: Archive, section: "developer"},
    },
    {
        id: "endpoints",
        label: "Endpoints",
        routes: ["/endpoints"],
        nav: {icon: PlugsIcon, section: "developer"},
    },
    {
        id: "playground",
        label: "Playground",
        routes: ["/apps/[app_id]/playground"],
    },
    {
        id: "evaluator-playground",
        label: "Evaluator playground",
        routes: ["/evaluators/playground"],
    },
    {
        id: "evaluations",
        label: "Evaluations",
        routes: ["/evaluations", "/evaluations/results/[evaluation_id]"],
        nav: {icon: ChartBar, section: "developer"},
    },
    {
        id: "observability-app-filter",
        label: "Filter by app",
    },
    {
        id: "annotation-queues",
        label: "Annotation queues",
        routes: ["/annotations", "/annotations/[queue_id]"],
        nav: {icon: Tray, section: "developer"},
    },
    {
        id: "testsets",
        label: "Test sets",
        routes: ["/testsets", "/testsets/archived", "/testsets/[testset_id]"],
        nav: {icon: TableIcon, section: "developer"},
    },
    {
        id: "variants",
        label: "Variants",
        routes: ["/variants"],
        nav: {icon: GitBranchIcon, section: "developer"},
    },
    {
        id: "prompts",
        label: "Prompts",
        routes: ["/prompts"],
        nav: {icon: FolderSimpleIcon, section: "developer"},
    },
    {
        id: "evaluators",
        label: "Evaluators",
        routes: ["/evaluators", "/evaluators/archived"],
        nav: {icon: ChartDonut, section: "developer"},
    },
    {
        id: "app-overview",
        label: "App overview",
        routes: ["/apps/[app_id]/overview"],
    },
    {
        id: "observability-actions",
        label: "Trace actions",
    },
]
