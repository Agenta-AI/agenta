/**
 * Evaluator Template Atoms
 *
 * Leaf module for the builtin evaluator template catalog (no dependency on
 * `./store`). Lives separately so `store.ts` can read template schemas while
 * seeding ephemeral evaluator entities without creating a module-load cycle.
 *
 * Re-exported from `./evaluatorUtils` for backward compatibility.
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {EvaluatorCatalogTemplate} from "../api/templates"
import {fetchEvaluatorTemplates} from "../api/templates"

/**
 * Query atom for evaluator template definitions.
 * Templates are static data (built-in evaluator types), cached for 5 minutes.
 */
export const evaluatorTemplatesQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["evaluatorTemplates", projectId],
        queryFn: async (): Promise<{count: number; templates: EvaluatorCatalogTemplate[]}> => {
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
export const evaluatorTemplatesDataAtom = atom<EvaluatorCatalogTemplate[]>((get) => {
    const query = get(evaluatorTemplatesQueryAtom)
    return query.data?.templates ?? []
})

/**
 * Derived atom: evaluator key → display name.
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

/**
 * Atom family to find a template by key.
 * Returns the matching EvaluatorCatalogTemplate or null.
 */
export const evaluatorTemplateByKeyAtomFamily = atomFamily((key: string | null) =>
    atom<EvaluatorCatalogTemplate | null>((get) => {
        if (!key) return null
        const templates = get(evaluatorTemplatesDataAtom)
        return templates.find((t) => t.key === key) ?? null
    }),
)
