import {createElement} from "react"

import {
    agentWorkflowsListQueryStateAtom,
    promptWorkflowsListQueryStateAtom,
} from "@agenta/entities/workflow"
import {playgroundSessionPath} from "@agenta/sessions/link"
import {addPendingSessionOpenAtom} from "@agenta/sessions/state"
import {ChatsCircleIcon, CircleIcon, CircleNotchIcon, LightningIcon} from "@phosphor-icons/react"
import {RobotIcon} from "@phosphor-icons/react"
import {atom, getDefaultStore} from "jotai"

import {MAIN_SIDEBAR_SCOPE_ID, SESSIONS_SIDEBAR_KEY} from "../constants"
import {SIDEBAR_AGENT_ORDER_ZONE} from "../reorder"

import {withEntityGroups, withRefsByRecency} from "./groups"
import {sidebarSessionToggledGroupsAtomFamily} from "./sessionFilters"
import {
    sidebarAgentRanksAtomFamily,
    sidebarSessionGroupKey,
    sidebarSessionGroupsAtomFamily,
    sidebarSessionPageSize,
    sidebarSessionsListAtomFamily,
    type SessionSidebarRef,
} from "./sessionsSource"
import {gatedSidebarSource} from "./source"
import type {
    SidebarEntity,
    SidebarEntityConfig,
    SidebarEntityRef,
    SidebarEntitySource,
} from "./types"

const DEFAULT_SIDEBAR_ENTITY_LIMIT = 5

/** An entity that renders every ref it holds, however many that is — the list is bounded by what
 * has been fetched, not by a render cap. */
export const SIDEBAR_UNBOUNDED = Number.POSITIVE_INFINITY

// Sidebar item keys that own a dynamic entity list. The static row in
// `useSidebarConfig` and the registry entry below must share the same key —
// keep the constant the single source of truth.
export const PROMPTS_SIDEBAR_KEY = "project-prompts-link"
export const AGENTS_SIDEBAR_KEY = "project-agents-link"
export const TESTSETS_SIDEBAR_KEY = "app-testsets-link"
export const EVALUATORS_SIDEBAR_KEY = "project-evaluators-link"

/**
 * Turns an author config into a resolved {@link SidebarEntity}: applies open-state
 * gating, the `maxItems` default, and project-URL prefixing. Generic over the ref
 * type so `getLabel` / `childPath` are type-checked against the entity, then erases
 * the ref so the registry can hold all entities in one record.
 */
export const defineSidebarEntity = <TRef extends SidebarEntityRef>(
    scopeId: string,
    parentKey: string,
    config: SidebarEntityConfig<TRef>,
): SidebarEntity => ({
    parentKey,
    kind: config.kind,
    icon: config.icon,
    activeSourceAtom: gatedSidebarSource(scopeId, parentKey, config.listAtom),
    getLabel: (ref) => config.getLabel(ref as TRef),
    childLink: (ref, projectURL) => `${projectURL}${config.childPath(ref as TRef)}`,
    childMatchLinks: config.childMatchPaths
        ? (ref, projectURL) =>
              config.childMatchPaths!(ref as TRef).map((path) => `${projectURL}${path}`)
        : undefined,
    emptyLabel: config.emptyLabel,
    maxItems: config.maxItems ?? DEFAULT_SIDEBAR_ENTITY_LIMIT,
    dragZone: config.dragZone,
    showAllLink: config.showAllPath
        ? (projectURL) => `${projectURL}${config.showAllPath}`
        : undefined,
    getIcon: config.getIcon ? (ref) => config.getIcon!(ref as TRef) : undefined,
    getTooltip: config.getTooltip ? (ref) => config.getTooltip!(ref as TRef) : undefined,
    getRowClassName: config.getRowClassName
        ? (ref) => config.getRowClassName!(ref as TRef)
        : undefined,
    getOnClick: config.getOnClick ? (ref) => config.getOnClick!(ref as TRef) : undefined,
    wrapRow: config.wrapRow ? (ref, node) => config.wrapRow!(ref as TRef, node) : undefined,
    getGroupKey: config.getGroupKey ? (ref) => config.getGroupKey!(ref as TRef) : undefined,
    ranksAtom: config.ranksAtom,
    groupsAtom: config.groupsAtom,
    toggleGroupAtom: config.toggleGroupAtom,
})

// ── Add a new dynamic entity by appending one entry here. Nothing else. ──────
// If the entity only exposes query + data atoms (no combined ListQueryState),
// wrap them: `listAtom: fromParts(xxxListQueryAtom, xxxListDataAtom)`.
// Test sets and evaluators render as STATIC rows (see `useSidebarConfig`) — their keys are
// exported below so a dynamic list can be added here later without renaming anything.
const ENTITIES: SidebarEntity[] = [
    defineSidebarEntity(MAIN_SIDEBAR_SCOPE_ID, PROMPTS_SIDEBAR_KEY, {
        kind: "app",
        listAtom: promptWorkflowsListQueryStateAtom,
        getLabel: (workflow) => workflow.name || workflow.slug || "Untitled prompt",
        childPath: (workflow) => `/apps/${workflow.id}/playground`,
        emptyLabel: "No prompts",
        showAllPath: "/prompts",
    }),
    defineSidebarEntity<SessionSidebarRef>(MAIN_SIDEBAR_SCOPE_ID, SESSIONS_SIDEBAR_KEY, {
        kind: "app",
        icon: createElement(ChatsCircleIcon, {size: 14}),
        listAtom: sidebarSessionsListAtomFamily(MAIN_SIDEBAR_SCOPE_ID),
        getLabel: (session) => session.name || "Untitled session",
        // The session's own deep link, so copy/open-in-new-tab lands here (#5974).
        childPath: (session) =>
            session.appId
                ? playgroundSessionPath("/apps", session.appId, session.sessionId)
                : "/sessions",
        // Highlight on the agent's playground whatever session the URL carries.
        childMatchPaths: (session) => (session.appId ? [`/apps/${session.appId}/playground`] : []),
        getOnClick: (session) => () => {
            // No resolved agent yet: nothing to open, but the row keeps its place (#5974).
            if (!session.appId) return
            getDefaultStore().set(addPendingSessionOpenAtom, {
                appId: session.appId,
                sessionId: session.sessionId,
                title: session.name ?? undefined,
            })
        },
        // A turn in flight SPINS, the same signal the mobile rail paints — `alive` alone left a
        // running session showing the idle hollow dot.
        // Amber for a session blocked on you, the same signal the sessions list and the home
        // panel paint. `--ag-run-status-warning` rather than `colorWarning`: the semantic token's
        // light step is a muddy #8a6400 that reads as disabled at this size.
        // Every row gets the same status dot, pinned included: the Pinned heading already says a
        // row is pinned, and a pin glyph in its place hid whether that session was waiting on you.
        getIcon: (session) => {
            // State wins the glyph while a turn is live; otherwise the SHAPE says the type — a
            // bolt for a trigger run, a dot for a chat — and the colour still carries the gate.
            const amber = session.waiting ? "text-[var(--ag-run-status-warning)]" : undefined
            if (session.running)
                return createElement(CircleNotchIcon, {size: 12, className: "animate-spin"})
            if (session.isAutomation)
                return createElement(LightningIcon, {
                    size: 12,
                    // Fill means LIVE on both glyphs; the bolt shape alone says automation.
                    weight: session.waiting || session.alive ? "fill" : "regular",
                    className: amber,
                })
            return createElement(CircleIcon, {
                size: 10,
                weight: session.waiting || session.alive ? "fill" : "regular",
                className: amber,
            })
        },
        // The label alone cannot say WHICH agent a session belongs to (#5945), and the heading
        // only says it under agent grouping. Falls back to the full name when no agent resolves.
        getTooltip: (session) => {
            const name = session.name?.trim() || "Untitled session"
            const agent = session.agentName?.trim()
            return agent ? `${name} — ${agent}` : undefined
        },
        emptyLabel: "No sessions",
        // Grouped by owning agent, with the same headings, filters and row menu the mobile rail
        // uses — one model, two hosts.
        getGroupKey: sidebarSessionGroupKey,
        groupsAtom: sidebarSessionGroupsAtomFamily(MAIN_SIDEBAR_SCOPE_ID),
        toggleGroupAtom: sidebarSessionToggledGroupsAtomFamily(MAIN_SIDEBAR_SCOPE_ID),
        // An archived row is second-class, not hidden: same row, dimmed.
        getRowClassName: (session) => (session.archived ? "opacity-60" : undefined),
        // Every loaded page renders; the scroll container pages in more as you reach its end.
        maxItems: SIDEBAR_UNBOUNDED,
    }),
    defineSidebarEntity(MAIN_SIDEBAR_SCOPE_ID, AGENTS_SIDEBAR_KEY, {
        kind: "app",
        icon: createElement(RobotIcon, {size: 14}),
        listAtom: agentWorkflowsListQueryStateAtom,
        getLabel: (workflow) => workflow.name || workflow.slug || "Untitled agent",
        // An agent's surface is its overview — its config, sessions and runs live there (#6389).
        childPath: (workflow) => `/apps/${workflow.id}/overview`,
        // Busiest agent first, by session count — stable session to session, unlike recency,
        // which reshuffled on every turn. Frozen per page load. Same rule the mobile rail applies.
        ranksAtom: sidebarAgentRanksAtomFamily(MAIN_SIDEBAR_SCOPE_ID),
        // The rail's agent order IS the agent order: the headings under Sessions arrange the
        // same list, through the rank atom above.
        dragZone: SIDEBAR_AGENT_ORDER_ZONE,
        emptyLabel: "No agents",
        showAllPath: "/agents",
    }),
]

/** All dynamic entities keyed by their sidebar item key. */
export const SIDEBAR_ENTITIES: Record<string, SidebarEntity> = Object.fromEntries(
    ENTITIES.map((entity) => [entity.parentKey, entity]),
)

/**
 * Aggregate of every entity's gated source in one subscription. Each source still
 * gates on its own key, so closed groups stay `idle` and never fetch — aggregating
 * does not widen the fetch surface.
 */
export const sidebarEntitySourcesAtom = atom((get) => {
    const sources: Record<string, SidebarEntitySource> = {}
    for (const [key, entity] of Object.entries(SIDEBAR_ENTITIES)) {
        const source = get(entity.activeSourceAtom)
        // Ranks are read only once the source HAS rows: a ranks atom reaches other entities'
        // queries (agents rank off the sessions), and reading it unconditionally would subscribe
        // those from a collapsed rail that renders nothing — the gate above exists to stop exactly
        // that. `withRefsByRecency` no-ops on a non-ready source anyway.
        let ordered = source
        if (entity.ranksAtom && source.status === "ready") {
            const ranks = get(entity.ranksAtom)
            ordered = withRefsByRecency(source, (ref) => ranks.get(ref.id))
        }
        sources[key] = withEntityGroups(ordered, entity.groupsAtom && get(entity.groupsAtom))
    }
    return sources
})
