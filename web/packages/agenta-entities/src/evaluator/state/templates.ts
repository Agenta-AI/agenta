/**
 * Evaluator Templates & Key Map Atoms
 *
 * Provides:
 * - `evaluatorTemplatesQueryAtom` — fetches static template definitions
 * - `evaluatorTemplatesMapAtom` — derived `Map<key, displayName>` for badge labels
 * - `evaluatorKeyMapAtom` — derived `Map<workflowId, evaluatorKey>` from revision data
 *
 * These atoms replace the OSS-only `evaluatorsAtom` + `useEvaluatorKeyMap` hook,
 * making evaluator enrichment available at the package level.
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import type {EvaluatorTemplate} from "../api/templates"
import {fetchEvaluatorTemplates} from "../api/templates"
import {parseEvaluatorKeyFromUri} from "../core"

import {nonArchivedEvaluatorsAtom, evaluatorQueryAtomFamily} from "./store"

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
 *
 * Replaces the OSS `evaluatorDefsByKey` from `useEvaluatorEnrichedData`.
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
 * (via `evaluatorQueryAtomFamily` which batch-fetches automatically),
 * extracts `data.uri`, and parses the evaluator key.
 *
 * This replaces the OSS `useEvaluatorKeyMap` hook's batch-fetch logic.
 * The existing `evaluatorLatestRevisionBatchFetcher` in store.ts handles
 * batching automatically when multiple `evaluatorQueryAtomFamily` atoms
 * are read in the same tick.
 */
export const evaluatorKeyMapAtom = atom<Map<string, string>>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    const map = new Map<string, string>()

    for (const evaluator of evaluators) {
        if (!evaluator.id) continue

        // Read the latest revision which contains data.uri
        const revisionQuery = get(evaluatorQueryAtomFamily(evaluator.id))
        const revision = revisionQuery.data
        if (!revision) continue

        const uri = revision.data?.uri
        if (!uri) continue

        const key = parseEvaluatorKeyFromUri(uri)
        if (key) map.set(evaluator.id, key)
    }

    return map
})
