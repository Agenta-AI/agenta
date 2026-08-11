import type {RouteLayer} from "@/oss/state/appState"
import type {PlaygroundAgentState} from "@/oss/state/workflow"

import type {SidebarScope} from "../engine/types"

import {
    MAIN_SIDEBAR_SCOPE_ID,
    SETTINGS_SIDEBAR_SCOPE_ID,
    WORKFLOW_SIDEBAR_SCOPE_ID,
} from "./constants"
import {mainSidebarScope} from "./mainScope"
import {createSettingsSidebarScope} from "./settingsScope"
import {createWorkflowSidebarScope} from "./workflowScope"

export interface SidebarViewMatchContext {
    pathname: string
    routeLayer: RouteLayer
    /** Agent-ness of the routed app — "unknown" until its workflow type resolves. */
    agentState: PlaygroundAgentState
    /** The view on screen right now; held while `agentState` is unknown so the rail can't flash. */
    currentViewId?: string
}

export interface SidebarViewContext {
    /** Where the back button returns to when leaving a swap view. */
    lastPath?: string
}

export interface SidebarViewDefinition {
    id: string
    /** The base view matches everything; back buttons return to its last path. */
    isBase?: boolean
    matches: (ctx: SidebarViewMatchContext) => boolean
    create: (ctx: SidebarViewContext) => SidebarScope
}

// ── Add a new full-sidebar view by appending one entry here. Nothing else. ──
// Order is match precedence: most specific first, the base view (matches all)
// last. `matches` decides when the view activates; `create` builds its scope.
export const SIDEBAR_VIEWS = [
    {
        id: SETTINGS_SIDEBAR_SCOPE_ID,
        matches: (ctx: SidebarViewMatchContext) => ctx.pathname.endsWith("/settings"),
        create: ({lastPath}: SidebarViewContext) => createSettingsSidebarScope({lastPath}),
    },
    {
        id: WORKFLOW_SIDEBAR_SCOPE_ID,
        // Agents navigate flat: they keep the project rail and never swap to the app-context one.
        // Only classic prompt apps and evaluators get this view.
        matches: (ctx: SidebarViewMatchContext) =>
            ctx.routeLayer === "app" && ctx.agentState === "non-agent",
        create: ({lastPath}: SidebarViewContext) => createWorkflowSidebarScope({lastPath}),
    },
    {
        id: MAIN_SIDEBAR_SCOPE_ID,
        isBase: true,
        matches: () => true,
        create: () => mainSidebarScope,
    },
] as const satisfies readonly SidebarViewDefinition[]

export type SidebarViewId = (typeof SIDEBAR_VIEWS)[number]["id"]

const BASE_VIEW = SIDEBAR_VIEWS[SIDEBAR_VIEWS.length - 1]

/** First view whose `matches` accepts the path; falls back to the base view. */
export const resolveSidebarView = (ctx: SidebarViewMatchContext): SidebarViewDefinition => {
    const matched: SidebarViewDefinition =
        SIDEBAR_VIEWS.find((view) => view.matches(ctx)) ?? BASE_VIEW

    // App route whose agent-ness hasn't resolved yet. An agent ends on the base view and a classic
    // app on the workflow view, so committing now would swap the rail a moment later: hold the
    // workflow rail if it is already up. A cold load with no rail to hold lands on the base view,
    // which is where agents — the common case — belong anyway.
    if (
        matched.isBase &&
        ctx.routeLayer === "app" &&
        ctx.agentState === "unknown" &&
        ctx.currentViewId === WORKFLOW_SIDEBAR_SCOPE_ID
    ) {
        return getSidebarViewDefinition(WORKFLOW_SIDEBAR_SCOPE_ID)
    }

    return matched
}

/** Look up a view definition by id; falls back to the base view. */
export const getSidebarViewDefinition = (id: string): SidebarViewDefinition =>
    SIDEBAR_VIEWS.find((view) => view.id === id) ?? BASE_VIEW
