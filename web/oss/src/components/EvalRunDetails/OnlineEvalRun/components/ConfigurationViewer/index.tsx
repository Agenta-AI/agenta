import {memo, useEffect, useMemo, useState} from "react"

import {Collapse, Form, Segmented, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useRunId} from "@/oss/contexts/RunIdContext"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"

import {
    retrieveQueryRevision,
    type QueryConditionPayload,
    type QueryFilteringPayload,
} from "../../../../../services/onlineEvaluations/api"
import EvaluatorDetailsPreview from "../../../../pages/evaluations/onlineEvaluation/components/EvaluatorDetailsPreview"
import FiltersPreview from "../../../../pages/evaluations/onlineEvaluation/components/FiltersPreview"
import ReadOnlyBox from "../../../../pages/evaluations/onlineEvaluation/components/ReadOnlyBox"
import {EVALUATOR_CATEGORY_LABEL_MAP} from "../../../../pages/evaluations/onlineEvaluation/constants"
import {useEvaluatorDetails} from "../../../../pages/evaluations/onlineEvaluation/hooks/useEvaluatorDetails"
import {useEvaluatorTypeFromConfigs} from "../../../../pages/evaluations/onlineEvaluation/hooks/useEvaluatorTypeFromConfigs"
import {useEvaluatorTypeMeta} from "../../../../pages/evaluations/onlineEvaluation/hooks/useEvaluatorTypeMeta"

const {Text} = Typography
const JsonEditor = dynamic(() => import("@/oss/components/Editor/Editor"), {ssr: false})

const resolveTimestamp = (
    ...values: Array<string | number | null | undefined>
): string | number | null => {
    for (const value of values) {
        if (value === undefined || value === null || value === "") continue
        const parsed = dayjs(value)
        if (parsed.isValid()) return value
    }
    return null
}

function toStringValue(v: unknown): string {
    if (v === null || v === undefined) return ""
    if (typeof v === "string") return v
    if (typeof v === "number" || typeof v === "boolean") return String(v)
    try {
        return JSON.stringify(v)
    } catch {
        return String(v)
    }
}

function isFiltering(node: any): node is QueryFilteringPayload {
    return node && typeof node === "object" && Array.isArray((node as any).conditions)
}

function isCondition(node: any): node is QueryConditionPayload {
    return node && typeof node === "object" && typeof (node as any).field === "string"
}

function flattenConditions(
    node?: QueryFilteringPayload | QueryConditionPayload | null,
): QueryConditionPayload[] {
    if (!node) return []
    if (isCondition(node)) return [node]
    if (isFiltering(node)) {
        const result: QueryConditionPayload[] = []
        for (const child of node.conditions || []) {
            if (isFiltering(child)) result.push(...flattenConditions(child))
            else if (isCondition(child)) result.push(child)
        }
        return result
    }
    return []
}

const toArray = (value: any): any[] => {
    if (!value) return []
    if (Array.isArray(value)) return value
    if (typeof value === "object") return Object.values(value)
    return []
}

const pickString = (candidate: unknown): string | undefined => {
    if (typeof candidate === "string") {
        const trimmed = candidate.trim()
        if (trimmed.length) return trimmed
    }
    return undefined
}

const collectEvaluatorIdentifiers = (entry: any): string[] => {
    if (!entry || typeof entry !== "object") return []
    const ids = new Set<string>()
    ;[
        entry?.id,
        entry?.slug,
        entry?.key,
        entry?.uid,
        entry?.meta?.evaluator_key,
        entry?.flags?.evaluator_key,
        entry?.data?.id,
        entry?.data?.slug,
        entry?.data?.key,
        entry?.data?.evaluator_key,
    ].forEach((candidate) => {
        const value = pickString(candidate)
        if (value) ids.add(value)
    })
    return Array.from(ids)
}

const mergePlainObjects = (primary: any, fallback: any): any => {
    if (primary === undefined || primary === null) return fallback
    if (fallback === undefined || fallback === null) return primary

    const primaryIsObject = typeof primary === "object" && !Array.isArray(primary)
    const fallbackIsObject = typeof fallback === "object" && !Array.isArray(fallback)

    if (primaryIsObject && fallbackIsObject) {
        const result: Record<string, any> = {...fallback}
        Object.entries(primary).forEach(([key, value]) => {
            result[key] = mergePlainObjects(value, (fallback as Record<string, any>)[key])
        })
        return result
    }

    return primary
}

const mergeEvaluatorRecords = (runEvaluator?: any, catalogEvaluator?: any): any => {
    if (!runEvaluator) return catalogEvaluator
    if (!catalogEvaluator) return runEvaluator

    const merged: Record<string, any> = {
        ...catalogEvaluator,
        ...runEvaluator,
    }

    merged.data = mergePlainObjects(runEvaluator.data, catalogEvaluator.data)
    merged.settings_values = mergePlainObjects(
        runEvaluator.settings_values,
        catalogEvaluator.settings_values,
    )
    merged.metrics = runEvaluator.metrics ?? catalogEvaluator.metrics

    return merged
}

const ConfigurationViewer = () => {
    const runId = useRunId()
    const state = useAtomValue(evaluationRunStateFamily(runId!)) as any
    const enrichedRun = state?.enrichedRun
    const runIndex = state?.runIndex

    // Try to find a query reference in steps metadata
    const queryRef = useMemo(() => {
        const steps: Record<string, any> = runIndex?.steps || {}
        for (const meta of Object.values(steps)) {
            const refs = (meta as any)?.refs || {}
            if (refs?.query?.id) return {id: refs.query.id}
            if (refs?.query_revision?.id) return {revisionId: refs.query_revision.id}
        }
        return undefined
    }, [runIndex?.steps])

    const {data: previewEvaluators} = useEvaluators({preview: true, queries: {is_human: false}})
    const {data: projectEvaluators} = useEvaluators()

    const [revision, setRevision] = useState<any>()
    const [isQueryLoading, setIsQueryLoading] = useState(false)
    useEffect(() => {
        let mounted = true
        ;(async () => {
            try {
                setIsQueryLoading(true)
                if (!queryRef?.id) {
                    if (mounted) setRevision(undefined)
                    return
                }
                const res = await retrieveQueryRevision({query_ref: {id: queryRef.id}})
                if (mounted) setRevision(res?.query_revision || null)
            } catch {
                if (mounted) setRevision(null)
            } finally {
                if (mounted) setIsQueryLoading(false)
            }
        })()
        return () => {
            mounted = false
        }
    }, [queryRef?.id])

    const {filtering, windowing} = (revision?.data ?? {}) as {
        filtering?: QueryFilteringPayload
        windowing?: {rate?: number; limit?: number; newest?: string; oldest?: string}
    }

    const ratePercent = useMemo(() => {
        const r = typeof windowing?.rate === "number" ? windowing?.rate : undefined
        if (r === undefined || Number.isNaN(r)) return undefined
        const clamped = Math.max(0, Math.min(1, r))
        return Math.round(clamped * 100)
    }, [windowing?.rate])
    const evaluationTags = useMemo(() => {
        const source = (enrichedRun as any)?.tags ?? (enrichedRun as any)?.meta?.tags
        if (!source) return []
        if (Array.isArray(source)) {
            return source.filter(Boolean).map((value) => String(value))
        }
        if (typeof source === "object") {
            return Object.entries(source)
                .map(([key, value]) => {
                    if (value === true || value === null || value === undefined || value === "") {
                        return key
                    }
                    return `${key}: ${toStringValue(value)}`
                })
                .filter(Boolean)
        }
        return []
    }, [enrichedRun])

    const queryCreatedAt = useMemo(
        () =>
            resolveTimestamp(
                (revision as any)?.created_at,
                (revision as any)?.createdAt,
                (revision as any)?.createdAtTimestamp,
                (revision?.meta as any)?.created_at,
                (revision?.meta as any)?.createdAt,
            ),
        [revision],
    )

    const queryUpdatedAt = useMemo(
        () =>
            resolveTimestamp(
                (revision as any)?.updated_at,
                (revision as any)?.updatedAt,
                (revision as any)?.updatedAtTimestamp,
                (revision?.meta as any)?.updated_at,
                (revision?.meta as any)?.updatedAt,
            ),
        [revision],
    )

    const runCreatedAt = useMemo(
        () =>
            resolveTimestamp(
                queryCreatedAt,
                (enrichedRun as any)?.created_at,
                (enrichedRun as any)?.createdAt,
                (enrichedRun as any)?.createdAtTimestamp,
                (state?.rawRun as any)?.created_at,
                (state?.rawRun as any)?.createdAt,
                (state?.rawRun as any)?.createdAtTimestamp,
            ),
        [queryCreatedAt, enrichedRun, state?.rawRun],
    )

    const runUpdatedAt = useMemo(
        () =>
            resolveTimestamp(
                queryUpdatedAt,
                (enrichedRun as any)?.updated_at,
                (enrichedRun as any)?.updatedAt,
                (enrichedRun as any)?.updatedAtTimestamp,
                (state?.rawRun as any)?.updated_at,
                (state?.rawRun as any)?.updatedAt,
                (state?.rawRun as any)?.updatedAtTimestamp,
            ),
        [queryUpdatedAt, enrichedRun, state?.rawRun],
    )

    const historicalRangeLabel = useMemo(() => {
        if (!windowing?.oldest || !windowing?.newest) {
            if (!runCreatedAt) return "Live traffic"
            const created = dayjs(runCreatedAt)
            return created.isValid()
                ? `Live traffic since ${created.format("DD MMM YYYY")}`
                : "Live traffic"
        }

        const oldestDate = dayjs(windowing.oldest)
        const newestDate = dayjs(windowing.newest)
        if (oldestDate.isValid() && newestDate.isValid()) {
            const diffDays = Math.max(newestDate.diff(oldestDate, "day"), 0)
            if (diffDays > 0 && diffDays <= 31) {
                return `Historical window: Last ${diffDays} day${diffDays === 1 ? "" : "s"}`
            }
            return `Historical window: ${oldestDate.format("DD MMM YYYY")} – ${newestDate.format(
                "DD MMM YYYY",
            )}`
        }
        return "Historical window"
    }, [windowing?.oldest, windowing?.newest, runCreatedAt])

    // Resolve evaluator for details from runIndex
    const evaluatorFromRun = useMemo(() => {
        return ((enrichedRun as any)?.evaluators?.[0] as any) ?? undefined
    }, [enrichedRun])

    const evaluatorCatalogMatch = useMemo(() => {
        if (!evaluatorFromRun) return undefined
        const identifiers = collectEvaluatorIdentifiers(evaluatorFromRun).map((id) =>
            id.toLowerCase(),
        )
        if (!identifiers.length) return undefined

        const locateMatch = (list: any[]): any | undefined => {
            for (const candidate of list) {
                const candidateIds = collectEvaluatorIdentifiers(candidate).map((id) =>
                    id.toLowerCase(),
                )
                if (!candidateIds.length) continue
                if (candidateIds.some((id) => identifiers.includes(id))) {
                    return candidate
                }
            }
            return undefined
        }

        const previewList = toArray(previewEvaluators)
        const projectList = toArray(projectEvaluators)

        return locateMatch(previewList) ?? locateMatch(projectList)
    }, [evaluatorFromRun, previewEvaluators, projectEvaluators])

    const resolvedEvaluator = useMemo(
        () => mergeEvaluatorRecords(evaluatorFromRun, evaluatorCatalogMatch),
        [evaluatorFromRun, evaluatorCatalogMatch],
    )

    const evaluatorTypeLookup = useMemo(() => {
        const m = new Map<string, {slug: string; label: string}>()
        Object.entries(EVALUATOR_CATEGORY_LABEL_MAP).forEach(([slug, label]) => {
            m.set(slug, {slug, label: label as string})
        })
        return m
    }, [])
    const evaluatorDetails = useEvaluatorDetails({
        evaluator: resolvedEvaluator as any,
        evaluatorTypeLookup,
    })

    const {typeLabel, typeColor, fallbackColors} = useEvaluatorTypeMeta({
        details: evaluatorDetails as any,
        evaluatorRef: null,
        matchedPreviewEvaluator: null,
        enrichedRun: null,
        selectedEvaluatorConfig: null,
    })

    // Prefer config-derived label/color when available
    const {label: cfgLabel, color: cfgColor} = useEvaluatorTypeFromConfigs({
        evaluator: resolvedEvaluator,
    })
    const finalTypeLabel = cfgLabel ?? typeLabel
    const finalTypeColor = cfgColor ?? typeColor
    const finalFallbackColors = cfgColor ? undefined : fallbackColors
    const finalShowType = Boolean(finalTypeLabel)

    // Placeholder: tags currently disabled; keep logic scaffold for future enablement
    const showTagsSection = false
    const [evaluatorView, setEvaluatorView] = useState<"details" | "json">("details")
    const evaluatorJson = useMemo(() => {
        if (!resolvedEvaluator) return ""
        const seen = new WeakSet()
        try {
            return JSON.stringify(
                resolvedEvaluator,
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
    }, [resolvedEvaluator])
    const hasEvaluatorJson = evaluatorJson.trim().length > 0
    const evaluatorJsonKey = useMemo(() => {
        const prefix = resolvedEvaluator?.id ?? evaluatorFromRun?.id ?? "unknown"
        if (!hasEvaluatorJson) return `${prefix}-empty`
        const sample = evaluatorJson.slice(0, 32)
        return `${prefix}-${sample.length}-${sample}`
    }, [resolvedEvaluator?.id, evaluatorFromRun?.id, evaluatorJson, hasEvaluatorJson])

    return (
        <div
            className="w-full h-full overflow-auto px-6 bg-zinc-1 pt-2"
            id="tour-online-eval-configuration-panel"
        >
            {/* Top: evaluation info tag */}

            {/* Panels */}
            <div className="bg-white rounded-md border-1 border-solid border-[#0517290F] [&_.ant-collapse-header]:!px-4">
                <Collapse
                    bordered={false}
                    defaultActiveKey={["general", "configuration", "evaluator"]}
                    className="!rounded-none [&_.ant-collapse-header]:!py-2 [&_.ant-collapse-header]:!px-2 [&_.ant-collapse-content-box]:bg-white [&_.ant-collapse-content-box]:!px-2"
                >
                    <Collapse.Panel
                        header={<span>General</span>}
                        key="general"
                        style={{marginBottom: 8, padding: 0}}
                        className="!border-b-0"
                    >
                        <div className="p-4">
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <Form.Item label="Name" style={{marginBottom: 12}}>
                                        <ReadOnlyBox>{enrichedRun?.name || "—"}</ReadOnlyBox>
                                    </Form.Item>
                                    <Form.Item label="Created" style={{marginBottom: 12}}>
                                        <ReadOnlyBox>
                                            {runCreatedAt
                                                ? dayjs(runCreatedAt).format("DD MMM YYYY HH:mm")
                                                : "—"}
                                        </ReadOnlyBox>
                                    </Form.Item>
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <Form.Item label="Description" style={{marginBottom: 12}}>
                                        <ReadOnlyBox>
                                            {enrichedRun?.description
                                                ? String(enrichedRun.description)
                                                : "—"}
                                        </ReadOnlyBox>
                                    </Form.Item>
                                    <Form.Item label="Updated" style={{marginBottom: 12}}>
                                        <ReadOnlyBox>
                                            {runUpdatedAt
                                                ? dayjs(runUpdatedAt).format("DD MMM YYYY HH:mm")
                                                : "—"}
                                        </ReadOnlyBox>
                                    </Form.Item>
                                </div>

                                {showTagsSection ? (
                                    <Form.Item label="Tags" style={{marginBottom: 12}}>
                                        {evaluationTags.length ? (
                                            <div className="flex flex-wrap gap-1">
                                                {evaluationTags.map((tagValue, index) => (
                                                    <Tag
                                                        key={`${tagValue}-${index}`}
                                                        className="!m-0"
                                                    >
                                                        {tagValue}
                                                    </Tag>
                                                ))}
                                            </div>
                                        ) : (
                                            <Text type="secondary">No tags</Text>
                                        )}
                                    </Form.Item>
                                ) : null}
                            </Form>
                        </div>
                    </Collapse.Panel>
                    <Collapse.Panel
                        header={<span>Configuration</span>}
                        key="configuration"
                        style={{marginBottom: 8, padding: 0}}
                        className="!border-b-0"
                    >
                        <div className="p-4">
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
                                    <div className="min-w-0">
                                        <Form.Item label="" style={{marginBottom: 0}}>
                                            <FiltersPreview filtering={filtering} />
                                        </Form.Item>
                                    </div>
                                    <div className="min-w-0">
                                        <Form.Item label="Sampling rate" style={{marginBottom: 0}}>
                                            <ReadOnlyBox className="w-full max-w-[200px]">
                                                {ratePercent !== undefined
                                                    ? `${ratePercent}%`
                                                    : "—"}
                                            </ReadOnlyBox>
                                        </Form.Item>
                                    </div>
                                </div>
                                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 opacity-60">
                                        <Tag className="!m-0" bordered>
                                            Run on historical data
                                        </Tag>
                                    </div>
                                    <Text type="secondary">{historicalRangeLabel}</Text>
                                </div>
                            </Form>
                        </div>
                    </Collapse.Panel>

                    <Collapse.Panel
                        header={
                            <div className="flex w-full items-center justify-between gap-2 pr-1">
                                <span>Evaluator</span>
                                <div
                                    onClick={(event) => {
                                        event.stopPropagation()
                                    }}
                                >
                                    <Segmented
                                        options={[
                                            {label: "Details", value: "details"},
                                            {label: "JSON", value: "json"},
                                        ]}
                                        value={evaluatorView}
                                        onChange={(val) =>
                                            setEvaluatorView(val as "details" | "json")
                                        }
                                    />
                                </div>
                            </div>
                        }
                        key="evaluator"
                    >
                        <div className="p-4">
                            <Form layout="vertical" requiredMark={false}>
                                <Form.Item label="Evaluator" style={{marginBottom: 12}}>
                                    <ReadOnlyBox>
                                        <div className="flex items-center gap-2">
                                            <span>
                                                {resolvedEvaluator?.name ||
                                                    evaluatorFromRun?.name ||
                                                    "—"}
                                            </span>
                                            {resolvedEvaluator?.version ||
                                            evaluatorFromRun?.version ? (
                                                <Tag className="!m-0">
                                                    V
                                                    {resolvedEvaluator?.version ??
                                                        evaluatorFromRun?.version}
                                                </Tag>
                                            ) : null}
                                        </div>
                                    </ReadOnlyBox>
                                </Form.Item>
                                {evaluatorView === "details" ? (
                                    <EvaluatorDetailsPreview
                                        details={evaluatorDetails as any}
                                        typeLabel={finalTypeLabel}
                                        typeColor={finalTypeColor}
                                        fallbackColors={finalFallbackColors}
                                        showType={finalShowType}
                                    />
                                ) : hasEvaluatorJson ? (
                                    <div className="rounded-md border border-solid border-[#E4E7EC] bg-[#F8FAFC]">
                                        <JsonEditor
                                            key={evaluatorJsonKey}
                                            initialValue={evaluatorJson}
                                            language="json"
                                            codeOnly
                                            showToolbar={false}
                                            disabled
                                            enableResize={false}
                                            boundWidth
                                            dimensions={{width: "100%", height: 280}}
                                        />
                                    </div>
                                ) : (
                                    <ReadOnlyBox>No evaluator configuration available</ReadOnlyBox>
                                )}
                            </Form>
                        </div>
                    </Collapse.Panel>
                </Collapse>
            </div>
        </div>
    )
}

export default memo(ConfigurationViewer)
