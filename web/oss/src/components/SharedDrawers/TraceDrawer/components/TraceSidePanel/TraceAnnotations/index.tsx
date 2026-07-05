import {useMemo, useState} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {evaluatorsListDataAtom, type Workflow} from "@agenta/entities/workflow"
import {CloseOutlined} from "@ant-design/icons"
import {Button, Popover, Space} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import CustomAntdTag from "@/oss/components/CustomUIs/CustomAntdTag"
import EvaluatorDetailsPopover from "@/oss/components/SharedDrawers/TraceDrawer/components/EvaluatorDetailsPopover"
import {booleanValueColorClass} from "@/oss/lib/helpers/colors"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {groupAnnotationsByReferenceId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

import NoTraceAnnotations from "./components/NoTraceAnnotations"

const annotationPopoverClass =
    "w-[300px] [&_.ant-popover-container]:!p-0 [&_.ant-popover-title]:p-2 [&_.ant-popover-title]:border-b [&_.ant-popover-title]:border-solid [&_.ant-popover-title]:border-[var(--ag-colorSplit)] [&_.ant-popover-content]:p-2 [&_.ant-popover-content]:max-h-[200px] [&_.ant-popover-content]:overflow-y-auto"

interface TraceAnnotationsProps {
    annotations: AnnotationDto[]
}

type AnnotationCategory = "metric" | "note" | "extra"

interface AnnotationChipEntry {
    annotations: {value: any; user: string}[]
    average?: number
    latest?: boolean
    category: AnnotationCategory
}

interface AnnotationGroup {
    refId: string
    evaluator?: Workflow | null
    metrics: Record<string, AnnotationChipEntry>
}

const TraceAnnotations = ({annotations = []}: TraceAnnotationsProps) => {
    const [isAnnotationsPopoverOpen, setIsAnnotationsPopoverOpen] = useState<string | null>(null)
    const getPopoverKey = (refId: string, key: string) => `${refId}-${key}`
    const evaluators = useAtomValue(evaluatorsListDataAtom)

    const evaluatorMap = useMemo(() => {
        const map = new Map<string, Workflow>()
        evaluators.forEach((ev) => {
            if (ev?.slug) {
                map.set(ev.slug, ev)
            }
        })
        return map
    }, [evaluators])

    const grouped = useMemo<Record<string, AnnotationGroup>>(() => {
        const groupedMetrics = groupAnnotationsByReferenceId(annotations)
        const result: Record<string, AnnotationGroup> = {}

        for (const [refId, metrics] of Object.entries(groupedMetrics)) {
            const metricsBucket: Record<string, AnnotationChipEntry> = {}

            for (const [metricName, metricValue] of Object.entries(metrics)) {
                metricsBucket[metricName] = {
                    annotations: (metricValue.annotations || []) as {value: any; user: string}[],
                    average: metricValue.average,
                    latest: metricValue.latest,
                    category: "metric",
                }
            }

            result[refId] = {
                refId,
                evaluator: evaluatorMap.get(refId) || null,
                metrics: metricsBucket,
            }
        }

        for (const annotation of annotations) {
            const refId = annotation.references?.evaluator?.slug
            if (!refId) continue

            let bucket = result[refId]

            if (!bucket) {
                bucket = {
                    refId,
                    evaluator: evaluatorMap.get(refId) || null,
                    metrics: {},
                }
                result[refId] = bucket
            } else if (!bucket.evaluator) {
                bucket.evaluator = evaluatorMap.get(refId) || null
            }

            const outputs = (annotation.data?.outputs || {}) as Record<string, any>
            const categories: [AnnotationCategory, Record<string, any>][] = [
                ["note", outputs.notes || {}],
                ["extra", outputs.extra || {}],
            ]

            for (const [category, values] of categories) {
                for (const [key, value] of Object.entries(values)) {
                    if (value === undefined || value === null) continue

                    if (!bucket.metrics[key]) {
                        bucket.metrics[key] = {
                            annotations: [],
                            category,
                        }
                    }

                    bucket.metrics[key].annotations.push({
                        value,
                        user: annotation.createdBy || "",
                    })
                }
            }
        }

        return result
    }, [annotations, evaluatorMap])

    const hasAnnotations = useMemo(
        () =>
            Object.values(grouped).some((group) =>
                Object.values(group.metrics).some((entry) => entry.annotations.length > 0),
            ),
        [grouped],
    )

    const getSummaryValue = (metric: AnnotationChipEntry) => {
        if (metric.category === "metric") {
            if (metric.latest !== undefined) {
                return metric.latest ? "True" : "False"
            }
            if (metric.average !== undefined) {
                return `μ ${metric.average}`
            }
        }

        const uniqueValues = Array.from(
            new Set(
                metric.annotations
                    .map((annotation) => {
                        const rawValue = getStringOrJson(annotation.value)
                        if (typeof rawValue !== "string") return undefined
                        const singleLine = rawValue.replace(/\s+/g, " ").trim()
                        return singleLine.length > 0 ? singleLine : undefined
                    })
                    .filter((value): value is string => Boolean(value)),
            ),
        )

        if (uniqueValues.length === 0) return ""
        if (uniqueValues.length === 1) return uniqueValues[0]

        return `${uniqueValues.length} values`
    }

    return hasAnnotations ? (
        <div className="flex flex-col gap-3">
            {Object.values(grouped || {}).map((group) => {
                const filteredMetrics = Object.entries(group.metrics)
                    .filter(([, metric]) => metric.annotations.length > 0)
                    .sort(([a], [b]) => a.localeCompare(b))
                if (filteredMetrics.length === 0) return null

                return (
                    <div key={group.refId} className="flex flex-col gap-[6px]">
                        <div className="flex items-center gap-2">
                            <EvaluatorDetailsPopover
                                evaluator={group.evaluator}
                                fallbackLabel={group.refId}
                            >
                                <span className="text-[10px] text-muted-foreground">
                                    {group?.evaluator?.name || group.refId}
                                </span>
                            </EvaluatorDetailsPopover>
                        </div>

                        {filteredMetrics.map(([key, metric]) => {
                            const summaryValue = getSummaryValue(metric)
                            const booleanColorClass =
                                metric.latest !== undefined
                                    ? booleanValueColorClass(metric.latest)
                                    : undefined
                            const popoverTitle =
                                metric.category === "metric" &&
                                (metric.average !== undefined || metric.latest !== undefined) ? (
                                    <div className="flex items-center justify-between">
                                        <Space className="truncate overflow-hidden">
                                            <span>
                                                {metric.latest !== undefined
                                                    ? "Value:"
                                                    : "Total mean:"}
                                            </span>
                                            <CustomAntdTag
                                                value={
                                                    metric.latest !== undefined
                                                        ? metric.latest
                                                            ? "True"
                                                            : "False"
                                                        : `μ ${metric.average}`
                                                }
                                                className={booleanColorClass}
                                                bordered={false}
                                            />
                                        </Space>
                                        <Button
                                            type="text"
                                            icon={<CloseOutlined />}
                                            onClick={() => setIsAnnotationsPopoverOpen(null)}
                                            size="small"
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex flex-col overflow-hidden">
                                            <span className="truncate">{key}</span>
                                        </div>
                                        <Button
                                            type="text"
                                            icon={<CloseOutlined />}
                                            onClick={() => setIsAnnotationsPopoverOpen(null)}
                                            size="small"
                                        />
                                    </div>
                                )

                            return (
                                <div key={key}>
                                    <Popover
                                        overlayClassName={annotationPopoverClass}
                                        open={
                                            isAnnotationsPopoverOpen ===
                                            getPopoverKey(group.refId, key)
                                        }
                                        onOpenChange={(open) => {
                                            setIsAnnotationsPopoverOpen(
                                                open ? getPopoverKey(group.refId, key) : null,
                                            )
                                        }}
                                        placement="bottom"
                                        trigger="click"
                                        arrow={false}
                                        title={popoverTitle}
                                        content={
                                            <div className="flex flex-col gap-2">
                                                {metric.annotations?.map(
                                                    (annotation: any, i: number) => (
                                                        <div
                                                            className="flex flex-col gap-2"
                                                            key={i}
                                                        >
                                                            <UserAuthorLabel
                                                                name={annotation.user || ""}
                                                                showAvatar
                                                            />
                                                            <span className="px-1 text-muted-foreground">
                                                                {getStringOrJson(annotation.value)}
                                                            </span>
                                                        </div>
                                                    ),
                                                )}
                                            </div>
                                        }
                                    >
                                        <div
                                            className={clsx(
                                                "flex items-center flex-wrap gap-1 justify-between",
                                                "py-1 px-3 cursor-pointer",
                                                "rounded-lg border border-[var(--ag-c-BDC7D1)] border-solid",
                                            )}
                                        >
                                            <span className="truncate overflow-hidden text-ellipsis flex-1">
                                                {key}
                                            </span>
                                            {summaryValue ? (
                                                <span
                                                    className={clsx(
                                                        "truncate overflow-hidden text-ellipsis",
                                                        booleanColorClass ||
                                                            "text-muted-foreground",
                                                    )}
                                                >
                                                    {summaryValue}
                                                </span>
                                            ) : null}
                                        </div>
                                    </Popover>
                                </div>
                            )
                        })}
                    </div>
                )
            })}
        </div>
    ) : (
        <NoTraceAnnotations />
    )
}

export default TraceAnnotations
