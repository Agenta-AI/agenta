import {useMemo} from "react"

import type {RunSchema} from "@agenta/entities/evaluationRun/etl"
import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {evaluationRunQueryAtomFamily} from "@/oss/components/EvalRunDetails/atoms/table"

interface UseComparisonSchemasArgs {
    compareSlots: (string | null)[]
}

/**
 * Resolve each comparison run's own schema (steps + mappings), keyed by
 * runId.
 *
 * Comparison-row application/output cells must resolve against the
 * *comparison* run's schema — its invocation step keys differ from the base
 * run's, so `resolveMappings` against the base schema finds no matching
 * result and the cell renders "—". This hook fetches every compare slot's
 * run payload (cached via `evaluationRunQueryAtomFamily`) and extracts its
 * schema so the table can hand each comparison row the right one.
 *
 * Reads all slots through a single derived atom (same approach as
 * `useComparisonPaginations`) to avoid calling a hook per slot.
 */
const useComparisonSchemas = ({
    compareSlots,
}: UseComparisonSchemasArgs): Record<string, RunSchema | null> => {
    const schemasAtom = useMemo(
        () =>
            atom((get) => {
                const out: Record<string, RunSchema | null> = {}
                for (const runId of compareSlots) {
                    if (!runId) continue
                    const query = get(evaluationRunQueryAtomFamily(runId))
                    const data = query.data?.rawRun?.data
                    const steps = data?.steps
                    const mappings = data?.mappings
                    out[runId] =
                        Array.isArray(steps) && Array.isArray(mappings) ? {steps, mappings} : null
                }
                return out
            }),
        [compareSlots],
    )

    return useAtomValueWithSchedule(schemasAtom, {priority: LOW_PRIORITY})
}

export default useComparisonSchemas
