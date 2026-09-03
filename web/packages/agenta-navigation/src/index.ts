/**
 * @agenta/navigation — the nav MODEL every shell renders: entry/scope types, visibility,
 * persisted open/collapsed state, and the gated dynamic entity sources (fetch only when a
 * group opens). A desktop rail and a mobile drawer are two shells over this one model.
 */
export * from "./types"
export * from "./visibility"
export * from "./constants"
export * from "./supportLinks"
export * from "./state"
export * from "./dynamic"
export * from "./banners"

export {useSidebarResize} from "./useSidebarResize"

export {
    dropMissingAgentSessions,
    localSessionRefsAtom,
    withLocalSessions,
    type SessionSidebarRef,
} from "./dynamic/sessionsSource"
