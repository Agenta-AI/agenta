import {useMemo, useState} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Alert, Button, Form, Segmented, Skeleton, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import EvaluatorDetailsPreview from "@/oss/components/pages/evaluations/onlineEvaluation/components/EvaluatorDetailsPreview"
import EvaluatorTypeTag from "@/oss/components/pages/evaluations/onlineEvaluation/components/EvaluatorTypeTag"
import {EVALUATOR_CATEGORY_LABEL_MAP} from "@/oss/components/pages/evaluations/onlineEvaluation/constants"
import {useEvaluatorDetails} from "@/oss/components/pages/evaluations/onlineEvaluation/hooks/useEvaluatorDetails"
import {useEvaluatorTypeFromConfigs} from "@/oss/components/pages/evaluations/onlineEvaluation/hooks/useEvaluatorTypeFromConfigs"
import {useEvaluatorTypeMeta} from "@/oss/components/pages/evaluations/onlineEvaluation/hooks/useEvaluatorTypeMeta"
import ReferenceTag from "@/oss/components/References/ReferenceTag"

import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../../../atoms/table/evaluators"
import type {EvaluatorDefinition} from "../../../../atoms/table/types"
import useRunScopedUrls from "../../../../hooks/useRunScopedUrls"
import {stringifyError} from "../utils"

import {SectionCard, SectionLabel} from "./SectionPrimitives"

const {Text} = Typography
const JsonEditor = dynamic(() => import("@/oss/components/Editor/Editor"), {ssr: false})

interface EvaluatorSectionProps {
    runId: string
}

const EvaluatorSection = ({runId}: EvaluatorSectionProps) => {
    const evaluatorsAtom = useMemo(() => evaluationEvaluatorsByRunQueryAtomFamily(runId), [runId])
    const evaluatorsQuery = useAtomValue(evaluatorsAtom)
    const evaluators = (evaluatorsQuery.data as EvaluatorDefinition[] | undefined) ?? []
    const isLoading = evaluatorsQuery.isPending || evaluatorsQuery.isFetching
    const error = evaluatorsQuery.error
    const evaluatorTypeLookup = useMemo(() => {
        const entries = Object.entries(EVALUATOR_CATEGORY_LABEL_MAP || {})
        return new Map(entries.map(([slug, label]) => [slug, {slug, label: label as string}]))
    }, [])

    if (isLoading) {
        return <Skeleton active paragraph={{rows: 3}} />
    }

    if (error) {
        return (
            <Alert
                type="error"
                showIcon
                message="Failed to load evaluator details"
                description={stringifyError(error)}
            />
        )
    }

    if (!evaluators.length) {
        return <Text type="secondary">No evaluator reference found for this run.</Text>
    }

    return (
        <div className="flex flex-col gap-4">
            {evaluators.map((evaluator, index) => (
                <EvaluatorCard
                    key={evaluator.id}
                    evaluator={evaluator}
                    evaluatorTypeLookup={evaluatorTypeLookup}
                    runId={runId}
                    index={index}
                />
            ))}
        </div>
    )
}

const EvaluatorCard = ({
    evaluator,
    evaluatorTypeLookup,
    runId,
    index,
}: {
    evaluator: EvaluatorDefinition
    evaluatorTypeLookup: Map<string, {slug: string; label: string}>
    runId: string
    index: number
}) => {
    const rawEvaluator = evaluator.raw
    const [view, setView] = useState<"details" | "json">("details")
    const [collapsed, setCollapsed] = useState(false)

    const details = useEvaluatorDetails({
        evaluator: rawEvaluator as any,
        evaluatorTypeLookup,
    })

    const {typeLabel, typeColor, fallbackColors} = useEvaluatorTypeMeta({
        details,
        evaluatorRef: rawEvaluator ? {id: rawEvaluator.id, slug: rawEvaluator.slug} : null,
        matchedPreviewEvaluator: null,
        enrichedRun: null,
        selectedEvaluatorConfig: null,
    })

    const {label: cfgLabel, color: cfgColor} = useEvaluatorTypeFromConfigs({
        evaluator: rawEvaluator,
    })

    const finalTypeLabel = cfgLabel ?? typeLabel
    const finalTypeColor = cfgColor ?? typeColor
    const finalFallbackColors = cfgColor ? undefined : fallbackColors
    const finalShowType = Boolean(finalTypeLabel)
    const evaluatorDisplayLabel =
        evaluator.name || evaluator.slug || rawEvaluator?.name || rawEvaluator?.slug
            ? (evaluator.name ??
              evaluator.slug ??
              rawEvaluator?.name ??
              rawEvaluator?.slug ??
              `Evaluator ${index + 1}`)
            : `Evaluator ${index + 1}`

    const evaluatorJson = useMemo(() => {
        if (!rawEvaluator) return ""
        const seen = new WeakSet()
        try {
            return JSON.stringify(
                rawEvaluator,
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
    }, [rawEvaluator])

    const hasEvaluatorJson = evaluatorJson.trim().length > 0
    const evaluatorJsonKey = useMemo(() => {
        const prefix = rawEvaluator?.id ?? evaluator.id ?? "evaluator"
        if (!hasEvaluatorJson) return `${prefix}-empty`
        const sample = evaluatorJson.slice(0, 32)
        return `${prefix}-${sample.length}-${sample}`
    }, [rawEvaluator?.id, evaluator.id, evaluatorJson, hasEvaluatorJson])

    const metricsFallback = Array.isArray(evaluator.metrics) ? evaluator.metrics : []

    const {projectURL} = useRunScopedUrls(runId)
    const evaluatorHref = projectURL
        ? `${projectURL}/evaluators/configure/${evaluator.id}`
        : undefined

    return (
        <Form layout="vertical" requiredMark={false}>
            <SectionCard>
                {rawEvaluator ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col gap-1">
                                <Typography.Title level={5} className="!mb-0 !mt-0 text-[#101828]">
                                    {evaluatorDisplayLabel}
                                </Typography.Title>
                                <div className="flex flex-wrap items-center gap-2">
                                    <ReferenceTag
                                        label={evaluator.name || evaluator.slug || "—"}
                                        copyValue={evaluator.id}
                                        tooltip={evaluator.name || evaluator.slug || evaluator.id}
                                        href={evaluatorHref}
                                        showIcon={Boolean(evaluatorHref)}
                                        className="max-w-[220px]"
                                        tone="evaluator"
                                    />
                                    {finalShowType ? (
                                        <EvaluatorTypeTag
                                            label={finalTypeLabel!}
                                            color={finalTypeColor}
                                            fallback={finalFallbackColors}
                                        />
                                    ) : null}
                                    {evaluator.version ? (
                                        <Tag className="!m-0 !bg-[#0517290F]" bordered={false}>
                                            V{evaluator.version}
                                        </Tag>
                                    ) : null}
                                </div>
                                {evaluator.description ? (
                                    <Text type="secondary">{evaluator.description}</Text>
                                ) : null}
                            </div>
                            <div className="flex items-start gap-2">
                                {hasEvaluatorJson ? (
                                    <Segmented
                                        options={[
                                            {label: "Details", value: "details"},
                                            {label: "JSON", value: "json"},
                                        ]}
                                        size="small"
                                        value={view}
                                        onChange={(val) => setView(val as "details" | "json")}
                                    />
                                ) : null}
                                <Button
                                    type="text"
                                    size="small"
                                    icon={
                                        <DownOutlined
                                            rotate={collapsed ? -90 : 0}
                                            style={{fontSize: 12}}
                                        />
                                    }
                                    onClick={() => setCollapsed((v) => !v)}
                                />
                            </div>
                        </div>

                        {!collapsed ? (
                            <>
                                <div className="rounded-md border-[#E4E7EC]">
                                    {view === "json" && hasEvaluatorJson ? (
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
                                                dimensions={{width: "100%", height: 260}}
                                            />
                                        </div>
                                    ) : (
                                        <EvaluatorDetailsPreview
                                            details={details as any}
                                            typeLabel={finalTypeLabel}
                                            typeColor={finalTypeColor}
                                            fallbackColors={finalFallbackColors}
                                            showType={finalShowType}
                                        />
                                    )}
                                </div>

                                {metricsFallback.length > 0 ? (
                                    <div className="flex flex-col gap-1">
                                        <SectionLabel>Metrics</SectionLabel>
                                        <div className="flex flex-wrap gap-2">
                                            {metricsFallback.map((metric) => (
                                                <Tag
                                                    key={`${evaluator.id}-${metric.name}`}
                                                    className="!m-0"
                                                >
                                                    {metric.displayLabel ?? metric.name}
                                                </Tag>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <Text type="secondary">
                            Evaluator configuration snapshot is unavailable for this run.
                        </Text>
                        {metricsFallback.length ? (
                            <div className="flex flex-wrap gap-2">
                                {metricsFallback.map((metric) => (
                                    <Tag key={`${evaluator.id}-${metric.name}`} className="!m-0">
                                        {metric.displayLabel ?? metric.name}
                                    </Tag>
                                ))}
                            </div>
                        ) : null}
                    </div>
                )}
            </SectionCard>
        </Form>
    )
}

export default EvaluatorSection
