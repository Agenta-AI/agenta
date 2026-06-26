import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {atom} from "jotai"

import {MAIN_SIDEBAR_SCOPE_ID} from "../scopes/constants"

import {gatedSidebarSource} from "./source"
import type {
    SidebarEntity,
    SidebarEntityConfig,
    SidebarEntityRef,
    SidebarEntitySource,
} from "./types"

const DEFAULT_SIDEBAR_ENTITY_LIMIT = 3

// Sidebar item keys that own a dynamic entity list. The static row in
// `useSidebarConfig` and the registry entry below must share the same key —
// keep the constant the single source of truth.
export const PROMPTS_SIDEBAR_KEY = "project-prompts-link"

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
    activeSourceAtom: gatedSidebarSource(scopeId, parentKey, config.listAtom),
    getLabel: (ref) => config.getLabel(ref as TRef),
    childLink: (ref, projectURL) => `${projectURL}${config.childPath(ref as TRef)}`,
    emptyLabel: config.emptyLabel,
    maxItems: config.maxItems ?? DEFAULT_SIDEBAR_ENTITY_LIMIT,
    showAllLink: config.showAllPath
        ? (projectURL) => `${projectURL}${config.showAllPath}`
        : undefined,
})

// ── Add a new dynamic entity by appending one entry here. Nothing else. ──────
// If the entity only exposes query + data atoms (no combined ListQueryState),
// wrap them: `listAtom: fromParts(xxxListQueryAtom, xxxListDataAtom)`.
const ENTITIES: SidebarEntity[] = [
    defineSidebarEntity(MAIN_SIDEBAR_SCOPE_ID, PROMPTS_SIDEBAR_KEY, {
        kind: "app",
        listAtom: appWorkflowsListQueryStateAtom,
        getLabel: (workflow) => workflow.name || workflow.slug || "Untitled prompt",
        childPath: (workflow) => `/apps/${workflow.id}/overview`,
        emptyLabel: "No prompts",
        showAllPath: "/prompts",
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
        sources[key] = get(entity.activeSourceAtom)
    }
    return sources
})
