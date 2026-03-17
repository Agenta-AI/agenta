/**
 * Evaluator Utilities for Workflow Store
 *
 * Convenience atoms for evaluator-type workflows.
 * Evaluators are workflows with `flags.is_evaluator === true`.
 *
 * Provides:
 * - Evaluator-filtered list query atoms
 * - Template definitions query & key map
 * - Selection config for 1-level evaluator picker
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryWorkflows} from "../api"
import type {EvaluatorTemplate} from "../api/templates"
import {fetchEvaluatorTemplates} from "../api/templates"
import type {Workflow, WorkflowsResponse} from "../core"
import {parseWorkflowKeyFromUri} from "../core"

import {workflowProjectIdAtom, workflowLatestRevisionQueryAtomFamily} from "./store"

// ============================================================================
// EVALUATOR-FILTERED LIST QUERY
// ============================================================================

/**
 * Query atom for evaluator-type workflows only.
 * Calls `queryWorkflows` with `flags: { is_evaluator: true }`.
 */
export const evaluatorsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(workflowProjectIdAtom)
    return {
        queryKey: ["workflows", "evaluators", "list", projectId],
        queryFn: async (): Promise<WorkflowsResponse> => {
            if (!projectId) return {count: 0, workflows: []}
            return queryWorkflows({projectId, flags: {is_evaluator: true}})
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

/**
 * Derived atom for evaluator-type workflows list data.
 */
export const evaluatorsListDataAtom = atom<Workflow[]>((get) => {
    const query = get(evaluatorsListQueryAtom)
    return query.data?.workflows ?? []
})

/**
 * Derived atom for non-archived evaluator-type workflows.
 */
export const nonArchivedEvaluatorsAtom = atom<Workflow[]>((get) => {
    const evaluators = get(evaluatorsListDataAtom)
    return evaluators.filter((w) => !w.deleted_at)
})

// ============================================================================
// TEMPLATES QUERY
// ============================================================================

/**
 * Query atom for evaluator template definitions.
 * Templates are static data (built-in evaluator types), cached for 5 minutes.
 */
export const evaluatorTemplatesQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["evaluatorTemplates", projectId],
        queryFn: async (): Promise<{count: number; templates: EvaluatorTemplate[]}> => {
            if (!projectId) return {count: 0, templates: []}
            return fetchEvaluatorTemplates(projectId)
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Derived atom for the templates data array.
 */
export const evaluatorTemplatesDataAtom = atom<EvaluatorTemplate[]>((get) => {
    const query = get(evaluatorTemplatesQueryAtom)
    return query.data?.templates ?? []
})

/**
 * Derived atom: evaluator key → display name.
 *
 * Maps template keys to their display names, e.g.:
 * - "auto_exact_match" → "Exact Match"
 * - "auto_ai_critique" → "LLM-as-a-judge"
 */
export const evaluatorTemplatesMapAtom = atom<Map<string, string>>((get) => {
    const templates = get(evaluatorTemplatesDataAtom)
    const map = new Map<string, string>()
    for (const t of templates) {
        if (t.key && t.name) {
            map.set(t.key, t.name)
        }
    }
    return map
})

// ============================================================================
// EVALUATOR KEY MAP
// ============================================================================

/**
 * Derived atom: workflowId → evaluatorKey.
 *
 * For each non-archived evaluator workflow, reads its latest revision
 * (via `workflowQueryAtomFamily` which batch-fetches automatically),
 * extracts `data.uri`, and parses the evaluator key.
 */
export const evaluatorKeyMapAtom = atom<Map<string, string>>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    const map = new Map<string, string>()

    for (const evaluator of evaluators) {
        if (!evaluator.id) continue

        const revisionQuery = get(workflowLatestRevisionQueryAtomFamily(evaluator.id))
        const revision = revisionQuery.data
        if (!revision) continue

        const uri = revision.data?.uri
        if (!uri) continue

        const key = parseWorkflowKeyFromUri(uri)
        if (key) map.set(evaluator.id, key)
    }

    return map
})

// ============================================================================
// SELECTION CONFIG
// ============================================================================

/**
 * Selection config for the 1-level evaluator adapter.
 * Used by the entity selection system for simple evaluator pickers.
 */
export const evaluatorSelectionConfig = {
    evaluatorsAtom: nonArchivedEvaluatorsAtom,
    evaluatorsQueryAtom: evaluatorsListQueryAtom,
}

export type EvaluatorSelectionConfig = typeof evaluatorSelectionConfig
