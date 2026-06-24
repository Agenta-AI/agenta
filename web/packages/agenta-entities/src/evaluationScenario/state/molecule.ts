/**
 * EvaluationScenario molecule — reactive, decoupled (`{projectId, runId}` keyed) access to
 * a run's scenarios. Mirrors the evaluationRun molecule shape (selectors / atoms / get).
 *
 * @example
 *   const scenarios = useAtomValue(evaluationScenarioMolecule.selectors.list({projectId, runId}))
 *   const statuses = useAtomValue(evaluationScenarioMolecule.selectors.statuses({projectId, runId}))
 */
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryEvaluationScenarios} from "../api"
import type {EvaluationScenario, ScenarioListKey} from "../core"

function keyEqual(a: ScenarioListKey, b: ScenarioListKey): boolean {
    return a.projectId === b.projectId && a.runId === b.runId
}

// ============================================================================
// QUERY ATOM (per run)
// ============================================================================

export const evaluationScenariosQueryAtomFamily = atomFamily(
    ({projectId, runId}: ScenarioListKey) =>
        atomWithQuery(() => ({
            queryKey: ["evaluationScenarios", projectId, runId],
            queryFn: (): Promise<EvaluationScenario[]> =>
                queryEvaluationScenarios({projectId, runId}),
            enabled: !!projectId && !!runId,
            retry: false,
            staleTime: 30_000,
        })),
    keyEqual,
)

// ============================================================================
// DERIVED SELECTORS
// ============================================================================

const listAtomFamily = atomFamily(
    ({projectId, runId}: ScenarioListKey) =>
        atom<EvaluationScenario[]>((get) => {
            const query = get(evaluationScenariosQueryAtomFamily({projectId, runId}))
            return query.data ?? []
        }),
    keyEqual,
)

const idsAtomFamily = atomFamily(
    ({projectId, runId}: ScenarioListKey) =>
        atom<string[]>((get) => get(listAtomFamily({projectId, runId})).map((s) => s.id)),
    keyEqual,
)

const statusesAtomFamily = atomFamily(
    ({projectId, runId}: ScenarioListKey) =>
        atom<Record<string, string | null>>((get) => {
            const out: Record<string, string | null> = {}
            for (const s of get(listAtomFamily({projectId, runId}))) {
                out[s.id] = s.status ?? null
            }
            return out
        }),
    keyEqual,
)

// ============================================================================
// MOLECULE
// ============================================================================

export const evaluationScenarioMolecule = {
    selectors: {
        /** All scenarios for the run */
        list: listAtomFamily,
        /** Scenario IDs */
        ids: idsAtomFamily,
        /** Status keyed by scenario id */
        statuses: statusesAtomFamily,
    },
    atoms: {
        query: evaluationScenariosQueryAtomFamily,
    },
}
