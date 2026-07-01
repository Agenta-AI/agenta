import {createElement} from "react"

import {testsetsListAtom} from "@agenta/entities/testset"
import {
    agentWorkflowsListQueryStateAtom,
    evaluatorsListQueryAtom,
    nonArchivedEvaluatorsAtom,
    promptWorkflowsListQueryStateAtom,
} from "@agenta/entities/workflow"
import {RobotIcon} from "@phosphor-icons/react"
import {atom} from "jotai"

import {MAIN_SIDEBAR_SCOPE_ID} from "../scopes/constants"

import {fromParts, gatedSidebarSource} from "./source"
import type {
    SidebarEntity,
    SidebarEntityConfig,
    SidebarEntityRef,
    SidebarEntitySource,
} from "./types"

const DEFAULT_SIDEBAR_ENTITY_LIMIT = 5

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
        listAtom: promptWorkflowsListQueryStateAtom,
        getLabel: (workflow) => workflow.name || workflow.slug || "Untitled prompt",
        childPath: (workflow) => `/apps/${workflow.id}/overview`,
        emptyLabel: "No prompts",
        showAllPath: "/prompts",
    }),
    defineSidebarEntity(MAIN_SIDEBAR_SCOPE_ID, AGENTS_SIDEBAR_KEY, {
        kind: "app",
        icon: createElement(RobotIcon, {size: 14}),
        listAtom: agentWorkflowsListQueryStateAtom,
        getLabel: (workflow) => workflow.name || workflow.slug || "Untitled agent",
        childPath: (workflow) => `/apps/${workflow.id}/overview`,
        emptyLabel: "No agents",
        showAllPath: "/agents",
    }),
    defineSidebarEntity(MAIN_SIDEBAR_SCOPE_ID, TESTSETS_SIDEBAR_KEY, {
        kind: "testset",
        listAtom: testsetsListAtom,
        getLabel: (testset) => testset.name || "Untitled test set",
        childPath: (testset) => `/testsets/${testset.id}`,
        emptyLabel: "No test sets",
        showAllPath: "/testsets",
    }),
    defineSidebarEntity(MAIN_SIDEBAR_SCOPE_ID, EVALUATORS_SIDEBAR_KEY, {
        kind: "evaluator",
        listAtom: fromParts(evaluatorsListQueryAtom, nonArchivedEvaluatorsAtom),
        getLabel: (workflow) => workflow.name || workflow.slug || "Untitled evaluator",
        childPath: (workflow) => `/apps/${workflow.id}/overview`,
        emptyLabel: "No evaluators",
        showAllPath: "/evaluators",
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
