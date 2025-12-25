import {useMemo, useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Button, Popover, Space, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import CustomAntdTag from "@/oss/components/CustomUIs/CustomAntdTag"
import UserAvatarTag from "@/oss/components/CustomUIs/UserAvatarTag"
import EvaluatorDetailsPopover from "@/oss/components/SharedDrawers/TraceDrawer/components/EvaluatorDetailsPopover"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {groupAnnotationsByReferenceId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"
import {Evaluator} from "@/oss/lib/Types"
import {projectIdAtom} from "@/oss/state/project"

import {useStyles} from "./assets/styles"
import NoTraceAnnotations from "./components/NoTraceAnnotations"

interface TraceAnnotationsProps {
    annotations: AnnotationDto[]
}

type AnnotationCategory = "metric" | "note" | "extra"

interface AnnotationChipEntry {
    annotations: {value: any; user: string}[]
    average?: number
    category: AnnotationCategory
}

interface AnnotationGroup {
    refId: string
    evaluator?: Evaluator | EvaluatorPreviewDto | null
    metrics: Record<string, AnnotationChipEntry>
}

const TraceAnnotations = ({annotations}: TraceAnnotationsProps) => {
    const classes = useStyles()
    const [isAnnotationsPopoverOpen, setIsAnnotationsPopoverOpen] = useState<string | null>(null)
    const getPopoverKey = (refId: string, key: string) => `${refId}-${key}`
    const projectId = useAtomValue(projectIdAtom)
    const {data: evaluators = []} = useEvaluators({
        preview: true,
        projectId: projectId || undefined,
    })

    const evaluatorMap = useMemo(() => {
        const map = new Map<string, EvaluatorPreviewDto | Evaluator>()
        evaluators.forEach((ev) => {
            if (ev?.slug) {
                map.set(ev.slug, ev)
            } else if ((ev as Evaluator)?.key) {
                map.set((ev as Evaluator).key, ev as Evaluator)
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
                                <Typography.Text type="secondary" className="text-[10px]">
                                    {group?.evaluator?.name || group.refId}
                                </Typography.Text>
                            </EvaluatorDetailsPopover>
                        </div>

                        {filteredMetrics.map(([key, metric]) => {
                            const summaryValue = getSummaryValue(metric)
                            const popoverTitle =
                                metric.category === "metric" && metric.average !== undefined ? (
                                    <div className="flex items-center justify-between">
                                        <Space className="truncate overflow-hidden">
                                            <Typography.Text>Total mean:</Typography.Text>
                                            <CustomAntdTag
                                                value={`μ ${metric.average}`}
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
                                            <Typography.Text className="truncate">
                                                {key}
                                            </Typography.Text>
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
                                        overlayClassName={classes.annotationPopover}
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
                                                            <UserAvatarTag
                                                                modifiedBy={annotation.user || ""}
                                                            />
                                                            <Typography.Text
                                                                type="secondary"
                                                                className="px-1"
                                                            >
                                                                {getStringOrJson(annotation.value)}
                                                            </Typography.Text>
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
                                                "rounded-lg border border-[#BDC7D1] border-solid",
                                            )}
                                        >
                                            <Typography.Text className="truncate overflow-hidden text-ellipsis flex-1">
                                                {key}
                                            </Typography.Text>
                                            {summaryValue ? (
                                                <Typography.Text
                                                    type="secondary"
                                                    className="truncate overflow-hidden text-ellipsis"
                                                >
                                                    {summaryValue}
                                                </Typography.Text>
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
