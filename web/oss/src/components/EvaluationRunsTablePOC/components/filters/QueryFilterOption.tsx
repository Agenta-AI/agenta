import {memo, useMemo} from "react"

import {Typography} from "antd"
import {atom, useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {
    queryReferenceLookupAtomFamily,
    type EvaluationQueryConfigurationResult,
} from "@/oss/components/EvalRunDetails2/atoms/query"
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
            <Typography.Text className="text-gray-900" ellipsis>
                {option.label}
            </Typography.Text>
            {revisionFiltering ? (
                <FiltersPreview
                    filtering={revisionFiltering}
                    compact
                    compactMaxRows={1}
                    className="text-xs text-[#475467]"
                />
            ) : isLoading ? (
                <Typography.Text className="text-xs text-[#98A2B3]">
                    Loading filters…
                </Typography.Text>
            ) : fallbackSummary ? (
                <Typography.Text className="text-xs text-[#475467]" ellipsis>
                    {fallbackSummary}
                </Typography.Text>
            ) : (
                <Typography.Text className="text-xs text-[#98A2B3]">No filters</Typography.Text>
            )}
        </div>
    )
}

export default memo(QueryFilterOption)
