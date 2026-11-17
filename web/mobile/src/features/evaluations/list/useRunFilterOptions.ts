import {queryLiveQueries} from "@agenta/entities/evaluationRun"
import {testsetsListAtom} from "@agenta/entities/testset"
import {
    nonArchivedEvaluatorsAtom,
    workflowVariantsListQueryStateAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {useQuery} from "@tanstack/react-query"
import {atom, useAtomValue} from "jotai"

import type {ReferenceFilterKey} from "./useEvaluationRunsFilters"

export interface FilterOption {
    value: string
    label: string
}

const NO_WORKFLOWS = atom<readonly Workflow[]>([])
const NO_LIST = atom({data: [] as {id: string; name?: string | null}[]})

const toOptions = (
    entries: readonly {id: string; name?: string | null; slug?: string | null}[],
): FilterOption[] =>
    entries.map((entry) => ({value: entry.id, label: entry.name || entry.slug || entry.id}))

/**
 * The choices of the reference filters: evaluators, test sets, queries, and the variants of the
 * picked app. Nothing is read until `enabled`: the panel opens, or a chip needs a name.
 */
export const useRunFilterOptions = ({
    projectId,
    appId,
    enabled,
}: {
    projectId: string
    appId: string | null
    enabled: boolean
}): Record<ReferenceFilterKey, FilterOption[]> => {
    const evaluators = useAtomValue(enabled ? nonArchivedEvaluatorsAtom : NO_WORKFLOWS)
    const testsets = useAtomValue(enabled ? testsetsListAtom : NO_LIST).data
    const variants = useAtomValue(
        enabled && appId ? workflowVariantsListQueryStateAtomFamily(appId) : NO_LIST,
    ).data
    const queries = useQuery({
        queryKey: ["evaluation-runs", "filter-queries", projectId],
        queryFn: () => queryLiveQueries({projectId}),
        enabled: enabled && Boolean(projectId),
        staleTime: 60_000,
    })
    return {
        evaluator: toOptions(evaluators),
        testset: toOptions(testsets),
        query: toOptions(queries.data ?? []),
        variant: toOptions(variants),
    }
}
