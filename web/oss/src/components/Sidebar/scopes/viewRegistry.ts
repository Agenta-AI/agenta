import type {SidebarScope} from "../engine/types"

import {MAIN_SIDEBAR_SCOPE_ID, SETTINGS_SIDEBAR_SCOPE_ID} from "./constants"
import {mainSidebarScope} from "./mainScope"
import {createSettingsSidebarScope} from "./settingsScope"

export interface SidebarViewContext {
    /** Where the back button returns to when leaving a swap view. */
    lastPath?: string
}

export interface SidebarViewDefinition {
    id: string
    /** The base view matches everything; back buttons return to its last path. */
    isBase?: boolean
    matches: (pathname: string) => boolean
    create: (ctx: SidebarViewContext) => SidebarScope
}

// ── Add a new full-sidebar view by appending one entry here. Nothing else. ──
// Order is match precedence: most specific first, the base view (matches all)
// last. `matches` decides when the view activates; `create` builds its scope.
export const SIDEBAR_VIEWS = [
    {
        id: SETTINGS_SIDEBAR_SCOPE_ID,
        matches: (pathname: string) => pathname.endsWith("/settings"),
        create: ({lastPath}: SidebarViewContext) => createSettingsSidebarScope({lastPath}),
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
export const resolveSidebarView = (pathname: string): SidebarViewDefinition =>
    SIDEBAR_VIEWS.find((view) => view.matches(pathname)) ?? BASE_VIEW

/** Look up a view definition by id; falls back to the base view. */
export const getSidebarViewDefinition = (id: string): SidebarViewDefinition =>
    SIDEBAR_VIEWS.find((view) => view.id === id) ?? BASE_VIEW
