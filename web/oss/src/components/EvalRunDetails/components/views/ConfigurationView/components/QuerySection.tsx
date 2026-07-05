import {useMemo, useState} from "react"

import {Alert, Segmented} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import FiltersPreview from "@/oss/components/pages/evaluations/onlineEvaluation/components/FiltersPreview"

import {
    evaluationQueryReferenceAtomFamily,
    evaluationQueryRevisionAtomFamily,
} from "../../../../atoms/query"
import {QueryReferenceLabel} from "../../../references"
import {formatSamplingRate, stringifyError} from "../utils"

import {ReadOnlyContainer} from "./CopyableFields"
import {SectionHeaderRow} from "./SectionPrimitives"
const JsonEditor = dynamic(() => import("@agenta/ui/editor").then((module) => module.Editor), {
    ssr: false,
})
interface QuerySectionProps {
    runId: string
}

const QuerySection = ({runId}: QuerySectionProps) => {
    const queryReferenceAtom = useMemo(() => evaluationQueryReferenceAtomFamily(runId), [runId])
    const queryReference = useAtomValue(queryReferenceAtom)

    const queryRevisionAtom = useMemo(() => evaluationQueryRevisionAtomFamily(runId), [runId])
    const queryRevisionQuery = useAtomValue(queryRevisionAtom)
    const cfg = queryRevisionQuery.data
    const queryRevision = cfg?.revision
    const queryRevisionError = queryRevisionQuery.error
    const isLoading =
        (queryRevisionQuery.isPending || queryRevisionQuery.isFetching) &&
        !queryRevisionQuery.isError

    const revisionId =
        queryRevision?.id ?? queryReference.queryRevisionId ?? queryReference.queryId ?? null
    const revisionSlug =
        queryRevision?.slug ?? queryReference.queryRevisionSlug ?? queryReference.querySlug ?? null
    const revisionVersion = queryRevision?.version ?? queryReference.queryRevisionVersion ?? null

    const windowing = queryRevision?.windowing
    const filters = queryRevision?.filtering

    const [view, setView] = useState<"details" | "json">("details")

    const queryJson = useMemo(() => {
        const target = cfg?.revision ?? null
        if (!target) return ""
        const seen = new WeakSet()
        try {
            return JSON.stringify(
                target,
                (_key, value) => {
                    if (typeof value === "object" && value !== null) {
                        if (seen.has(value)) return "[Circular]"
                        seen.add(value)
                    }
                    if (typeof value === "function") return undefined
                    return value
                },
                2,
            )
        } catch {
            return ""
        }
    }, [cfg?.revision])

    if (isLoading && !queryRevision) {
        return <span className="text-muted-foreground">Loading…</span>
    }

    return (
        <>
            {queryRevisionError ? (
                <Alert
                    type="error"
                    showIcon
                    className="mb-1"
                    message="Failed to resolve query revision"
                    description={stringifyError(queryRevisionError)}
                />
            ) : null}

            <SectionHeaderRow
                left={
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-[var(--ag-c-344054)]">
                            Query
                        </span>
                    </div>
                }
                right={
                    queryJson ? (
                        <Segmented
                            options={[
                                {label: "Details", value: "details"},
                                {label: "JSON", value: "json"},
                            ]}
                            size="small"
                            value={view}
                            onChange={(val) => setView(val as "details" | "json")}
                        />
                    ) : undefined
                }
            />

            <div className="flex flex-wrap items-center gap-2 -mt-2">
                <QueryReferenceLabel
                    queryId={queryReference.queryId}
                    querySlug={queryReference.querySlug}
                />
                {(() => {
                    const revBase = revisionSlug ?? revisionId
                    const revLabel = revBase
                        ? `Rev: ${revBase}${
                              revisionVersion !== null && revisionVersion !== undefined
                                  ? ` (V${String(revisionVersion)})`
                                  : ""
                          }`
                        : null
                    if (!revLabel) return null
                    return <span className="text-sm text-neutral-600">{revLabel}</span>
                })()}
            </div>

            {view === "json" && queryJson ? (
                <div className="rounded-md border border-solid border-[var(--ag-c-E4E7EC)] bg-[var(--ag-c-F8FAFC)] mt-3">
                    <JsonEditor
                        key={(revisionId ?? revisionSlug ?? "query") as string}
                        initialValue={queryJson}
                        language="json"
                        codeOnly
                        showToolbar={false}
                        disabled
                        enableResize={false}
                        boundWidth
                        dimensions={{width: "100%", height: 260}}
                    />
                </div>
            ) : (
                <div className="flex flex-col gap-3 mt-3">
                    <div className="flex flex-col gap-1">
                        <span className="font-medium text-neutral-800">Filters</span>
                        <FiltersPreview filtering={filters ?? undefined} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="font-medium text-neutral-800">Sample rate</span>
                        <ReadOnlyContainer>{formatSamplingRate(windowing?.rate)}</ReadOnlyContainer>
                    </div>
                </div>
            )}
        </>
    )
}

export default QuerySection
