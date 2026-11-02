import {Archive, type Icon} from "@phosphor-icons/react"

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
        description: "Archived apps, with Restore.",
        routes: ["/apps/archived"],
        nav: {icon: Archive, section: "developer"},
        stage: "hidden",
    },
]
