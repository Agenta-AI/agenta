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

/**
 * How far a developer view has rolled out.
 *
 * - `hidden`: no nav link, and its route pages show "not found".
 * - `preview`: shown only to a user who turned it on in Settings › Preferences › Feature Flags.
 * - `on`: shown to everyone.
 *
 * A deployment can force any view on, whatever its stage: see `readForcedDeveloperViewIds`.
 */
export type DeveloperViewStage = "hidden" | "preview" | "on"

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
    /** Lowercase, kebab-case. Names the view in the env override and its preference key. */
    id: string
    /** The view's name: the rail link and the Preferences switch both show it. */
    label: string
    /** One sentence under the Preferences switch, saying what turning it on shows. */
    description: string
    /**
     * Next route patterns, relative to the project (`/w/[workspace_id]/p/[project_id]`), for
     * example `/testsets` and `/testsets/[testset_id]`. The first one is the nav link, so it
     * must have no params.
     */
    routes?: readonly [string, ...string[]]
    /** The rail link to `routes[0]`, titled `label`. Ignored on a view with no routes. */
    nav?: DeveloperViewNav
    stage: DeveloperViewStage
}

/**
 * Every developer view /m has, rebuilt from the old app one at a time.
 *
 * A view merges as `hidden`, moves to `preview`, then to `on`. Keep this file free of view code:
 * a view's screen loads only from its own route page, so listing it here adds nothing to the
 * pages every user opens.
 */
export const DEVELOPER_VIEWS: readonly DeveloperView[] = [
    {
        id: "archived-apps",
        label: "Archived apps",
        description:
            "Show the Archived apps page under Developer in the navigation. Restore an app from it.",
        routes: ["/apps/archived"],
        nav: {icon: Archive, section: "developer"},
        stage: "preview",
    },
    {
        id: "endpoints",
        label: "Endpoints",
        description: "Code to call an app and fetch its config, per environment.",
        routes: ["/endpoints"],
        nav: {icon: PlugsIcon, section: "developer"},
        stage: "preview",
    },
    {
        id: "playground",
        label: "Playground",
        description: "Edit and run prompt and chat apps.",
        routes: ["/apps/[app_id]/playground"],
        stage: "hidden",
    },
    {
        id: "evaluator-playground",
        label: "Evaluator playground",
        description: "Edit an evaluator and run it on test cases or on an app's output.",
        routes: ["/evaluators/playground"],
        stage: "hidden",
    },
    {
        id: "evaluations",
        label: "Evaluations",
        description: "Evaluation runs and their results.",
        routes: ["/evaluations", "/evaluations/results/[evaluation_id]"],
        nav: {icon: ChartBar, section: "developer"},
        stage: "hidden",
    },
    {
        id: "observability-app-filter",
        label: "Filter by app",
        description:
            "Filter traces and sessions by app, and open sessions for one agent from a link.",
        stage: "preview",
    },
    {
        id: "annotation-queues",
        label: "Annotation queues",
        description: "Show the Annotation queues page under Developer in the navigation.",
        routes: ["/annotations", "/annotations/[queue_id]"],
        nav: {icon: Tray, section: "developer"},
        stage: "preview",
    },
    {
        id: "testsets",
        label: "Test sets",
        description: "Show the Test sets page under Developer in the navigation.",
        routes: ["/testsets", "/testsets/archived", "/testsets/[testset_id]"],
        nav: {icon: TableIcon, section: "developer"},
        stage: "hidden",
    },
    {
        id: "variants",
        label: "Variants",
        description: "Variants of an app, their revisions, and where each is deployed.",
        routes: ["/variants"],
        nav: {icon: GitBranchIcon, section: "developer"},
        stage: "preview",
    },
    {
        id: "prompts",
        label: "Prompts",
        description: "Show the Prompts page under Developer in the navigation.",
        routes: ["/prompts"],
        nav: {icon: FolderSimpleIcon, section: "developer"},
        stage: "preview",
    },
    {
        id: "evaluators",
        label: "Evaluators",
        description: "Automatic and human evaluators, with archive and restore.",
        routes: ["/evaluators", "/evaluators/archived"],
        nav: {icon: ChartDonut, section: "developer"},
        stage: "preview",
    },
    {
        id: "app-overview",
        label: "App overview",
        description:
            "The overview of a prompt or custom app: deployments, recent prompts and evaluations.",
        routes: ["/apps/[app_id]/overview"],
        stage: "hidden",
    },
    {
        id: "observability-actions",
        label: "Trace actions",
        description:
            "Add to testset, Annotate, annotation filters and queue all matching traces on the traces page.",
        stage: "hidden",
    },
]
