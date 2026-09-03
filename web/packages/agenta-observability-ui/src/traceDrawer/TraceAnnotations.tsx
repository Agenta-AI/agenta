import {useMemo, useState} from "react"

import {groupAnnotationsByReferenceId} from "@agenta/entities/annotation/dto"
import {AnnotationDto} from "@agenta/entities/annotation/dto"
import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {evaluatorsListDataAtom, type Workflow} from "@agenta/entities/workflow"
import {getStringOrJson} from "@agenta/shared/utils"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {ValueTag} from "../primitives/ValueTag"
import {booleanValueColorClass} from "../primitives/valueTone"

import EvaluatorDetailsPopover from "./EvaluatorDetailsPopover"
import NoTraceAnnotations from "./NoTraceAnnotations"

const annotationPopoverClass =
    "w-[300px] [&_.ant-popover-container]:!p-0 [&_.ant-popover-title]:p-2 [&_.ant-popover-title]:border-b [&_.ant-popover-title]:border-solid [&_.ant-popover-title]:border-[var(--ag-colorSplit)] [&_.ant-popover-content]:p-2 [&_.ant-popover-content]:max-h-[200px] [&_.ant-popover-content]:overflow-y-auto"

interface TraceAnnotationsProps {
    annotations: AnnotationDto[]
}

type AnnotationCategory = "metric" | "note" | "extra"

interface AnnotationChipEntry {
    annotations: {value: unknown; user: string}[]
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
                    annotations: (metricValue.annotations || []) as {
                        value: unknown
                        user: string
                    }[],
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

            const outputs = (annotation.data?.outputs || {}) as Record<
                string,
                Record<string, unknown>
            >
            const categories: [AnnotationCategory, Record<string, unknown>][] = [
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
                                <span className="text-colorTextSecondary text-[12px]">
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
                                        <div className="flex items-center gap-2 truncate overflow-hidden">
                                            <span>
                                                {metric.latest !== undefined
                                                    ? "Value:"
                                                    : "Total mean:"}
                                            </span>
                                            <ValueTag
                                                value={
                                                    metric.latest !== undefined
                                                        ? metric.latest
                                                            ? "True"
                                                            : "False"
                                                        : `μ ${metric.average}`
                                                }
                                                className={booleanColorClass}
                                            />
                                        </div>
                                        <EnhancedButton
                                            type="text"
                                            icon={<X />}
                                            onClick={() => setIsAnnotationsPopoverOpen(null)}
                                            size="small"
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex flex-col overflow-hidden">
                                            <span className="truncate">{key}</span>
                                        </div>
                                        <EnhancedButton
                                            type="text"
                                            icon={<X />}
                                            onClick={() => setIsAnnotationsPopoverOpen(null)}
                                            size="small"
                                        />
                                    </div>
                                )

                            return (
                                <div key={key}>
                                    <Popover
                                        open={
                                            isAnnotationsPopoverOpen ===
                                            getPopoverKey(group.refId, key)
                                        }
                                        onOpenChange={(open) => {
                                            setIsAnnotationsPopoverOpen(
                                                open ? getPopoverKey(group.refId, key) : null,
                                            )
                                        }}
                                    >
                                        {/* antd took `title`/`content` as props and the trigger
                                            as children; Radix names all three explicitly. */}
                                        <PopoverTrigger asChild>
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
                                                                "text-colorTextSecondary",
                                                        )}
                                                    >
                                                        {summaryValue}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </PopoverTrigger>
                                        <PopoverContent
                                            side="bottom"
                                            className={annotationPopoverClass}
                                        >
                                            {popoverTitle}
                                            <div className="flex flex-col gap-2">
                                                {metric.annotations?.map(
                                                    (
                                                        annotation: {
                                                            user?: string
                                                            value?: unknown
                                                        },
                                                        i: number,
                                                    ) => (
                                                        <div
                                                            className="flex flex-col gap-2"
                                                            key={i}
                                                        >
                                                            <UserAuthorLabel
                                                                name={annotation.user || ""}
                                                                showAvatar
                                                            />
                                                            <span className="text-colorTextSecondary px-1">
                                                                {getStringOrJson(
                                                                    annotation.value as string,
                                                                )}
                                                            </span>
                                                        </div>
                                                    ),
                                                )}
                                            </div>
                                        </PopoverContent>
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
