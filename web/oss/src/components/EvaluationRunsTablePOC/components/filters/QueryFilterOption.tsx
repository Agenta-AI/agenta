import {memo, useMemo} from "react"

import {atom, useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {
    queryReferenceLookupAtomFamily,
    type EvaluationQueryConfigurationResult,
} from "@/oss/components/EvalRunDetails/atoms/query"
import FiltersPreview from "@/oss/components/pages/evaluations/onlineEvaluation/components/FiltersPreview"

import {summarizeQueryFilters} from "../../utils/querySummary"

interface QueryOption {
    value: string
    label: string
    summary?: string | null
    id?: string | null
    slug?: string | null
}

const idleQueryDetailValue: EvaluationQueryConfigurationResult = {
    reference: {
        queryId: undefined,
        querySlug: undefined,
        queryRevisionId: undefined,
        queryRevisionSlug: undefined,
        queryVariantId: undefined,
        queryVariantSlug: undefined,
        queryRevisionVersion: undefined,
    },
    revision: null,
}

const idleQueryDetailAtom = atom<EvaluationQueryConfigurationResult | null>(idleQueryDetailValue)
const idleQueryDetailLoadableAtom = loadable(idleQueryDetailAtom)

const QueryFilterOption = ({option}: {option: QueryOption}) => {
    const detailAtom = useMemo(() => {
        if (!option.id && !option.slug) {
            return idleQueryDetailLoadableAtom
        }
        return loadable(
            queryReferenceLookupAtomFamily({
                queryId: option.id ?? undefined,
                querySlug: option.slug ?? undefined,
            }),
        )
    }, [option.id, option.slug])

    const queryState = useAtomValue(detailAtom)
    const data =
        queryState.state === "hasData"
            ? ((queryState.data as EvaluationQueryConfigurationResult | null) ??
              idleQueryDetailValue)
            : idleQueryDetailValue
    const revisionFiltering = data?.revision?.filtering ?? undefined
    const isLoading = queryState.state === "loading"

    const fallbackSummary =
        revisionFiltering && !isLoading
            ? summarizeQueryFilters(revisionFiltering as any)
            : (option.summary ?? null)

    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-gray-900 truncate">{option.label}</span>
            {revisionFiltering ? (
                <FiltersPreview
                    filtering={revisionFiltering}
                    compact
                    compactMaxRows={1}
                    className="text-xs text-[var(--ag-c-475467)]"
                />
            ) : isLoading ? (
                <span className="text-xs text-[var(--ag-c-98A2B3)]">Loading filters…</span>
            ) : fallbackSummary ? (
                <span className="text-xs text-[var(--ag-c-475467)] truncate">
                    {fallbackSummary}
                </span>
            ) : (
                <span className="text-xs text-[var(--ag-c-98A2B3)]">No filters</span>
            )}
        </div>
    )
}

export default memo(QueryFilterOption)
