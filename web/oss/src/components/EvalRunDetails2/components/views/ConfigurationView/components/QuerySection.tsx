import {useMemo, useState} from "react"

import {Alert, Segmented, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import FiltersPreview from "@/oss/components/pages/evaluations/onlineEvaluation/components/FiltersPreview"

import {
    evaluationQueryReferenceAtomFamily,
    evaluationQueryRevisionAtomFamily,
} from "../../../../atoms/query"
import ReferenceTag from "../../../reference/ReferenceTag"
import {formatSamplingRate, formatWindowRange, stringifyError} from "../utils"

import {ReadOnlyContainer} from "./CopyableFields"
import {ConfigBlock, SectionCard, SectionHeaderRow} from "./SectionPrimitives"

const {Text} = Typography
const JsonEditor = dynamic(() => import("@/oss/components/Editor/Editor"), {ssr: false})

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
    const isLoading = queryRevisionQuery.isPending || queryRevisionQuery.isFetching

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
        return <Text type="secondary">Loading…</Text>
    }

    return (
        <SectionCard>
            {queryRevisionError ? (
                <Alert
                    type="error"
                    showIcon
                    className="mb-1"
                    message="Failed to resolve query revision"
                    description={stringifyError(queryRevisionError)}
                />
            ) : null}

            <div className="flex flex-col gap-2">
                <SectionHeaderRow
                    left={
                        <ReferenceTag
                            label={queryReference.querySlug ?? queryReference.queryId ?? "—"}
                            copyValue={queryReference.queryId ?? undefined}
                            showIcon={false}
                            className="max-w-[220px]"
                            tone="query"
                        />
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
                {(() => {
                    const revBase = revisionSlug ?? revisionId
                    const revLabel = revBase
                        ? `Rev: ${revBase}${
                              revisionVersion !== null && revisionVersion !== undefined
                                  ? ` (V${String(revisionVersion)})`
                                  : ""
                          }`
                        : null
                    const rawWindow = formatWindowRange(windowing)
                    const windowLabel = rawWindow === "Not specified" ? "—" : rawWindow
                    const parts = [revLabel, windowLabel].filter((p) => p && p !== "—")
                    if (parts.length === 0) return null
                    return <Text className="text-sm text-neutral-600">{parts.join(" • ")}</Text>
                })()}
            </div>

            {view === "json" && queryJson ? (
                <div className="rounded-md border border-solid border-[#E4E7EC] bg-[#F8FAFC]">
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
                <div className="flex flex-col gap-3">
                    <ConfigBlock title="Filters">
                        <FiltersPreview filtering={filters ?? undefined} />
                    </ConfigBlock>
                    <ConfigBlock title="Sample rate">
                        <ReadOnlyContainer>{formatSamplingRate(windowing?.rate)}</ReadOnlyContainer>
                    </ConfigBlock>
                </div>
            )}
        </SectionCard>
    )
}

export default QuerySection
