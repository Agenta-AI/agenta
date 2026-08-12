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
    /** Whether the type lookup has given its final answer, even if that answer is nothing. */
    agentTypeSettled: boolean
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
        // Agents navigate flat and keep the project rail; only classic apps and evaluators swap.
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
    // A settled lookup that still can't say never will — don't strand a classic app on this rail.
    const resolved: SidebarViewMatchContext =
        ctx.agentState === "unknown" && ctx.agentTypeSettled
            ? {...ctx, agentState: "non-agent"}
            : ctx

    const matched: SidebarViewDefinition =
        SIDEBAR_VIEWS.find((view) => view.matches(resolved)) ?? BASE_VIEW

    // Still loading: hold the app-context rail if it is up, rather than swap it away and back.
    if (
        matched.isBase &&
        resolved.routeLayer === "app" &&
        resolved.agentState === "unknown" &&
        resolved.currentViewId === WORKFLOW_SIDEBAR_SCOPE_ID
    ) {
        return getSidebarViewDefinition(WORKFLOW_SIDEBAR_SCOPE_ID)
    }

    return matched
}

/** Look up a view definition by id; falls back to the base view. */
export const getSidebarViewDefinition = (id: string): SidebarViewDefinition =>
    SIDEBAR_VIEWS.find((view) => view.id === id) ?? BASE_VIEW
