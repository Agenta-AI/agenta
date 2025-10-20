import React, {useMemo, useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Button, Popover, Space, Typography} from "antd"
import clsx from "clsx"

import CustomAntdTag from "@/oss/components/ui/CustomAntdTag"
import UserAvatarTag from "@/oss/components/ui/UserAvatarTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {groupAnnotationsByReferenceId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

import {useStyles} from "./assets/styles"
import NoTraceAnnotations from "./components/NoTraceAnnotations"

interface TraceAnnotationsProps {
    annotations: AnnotationDto[]
}

type AnnotationCategory = "metric" | "note" | "extra"

type AnnotationChipEntry = {
    annotations: {value: any; user: string}[]
    average?: number
    category: AnnotationCategory
}

const TraceAnnotations = ({annotations}: TraceAnnotationsProps) => {
    const classes = useStyles()
    const [isAnnotationsPopoverOpen, setIsAnnotationsPopoverOpen] = useState<string | null>(null)
    const getPopoverKey = (refId: string, key: string) => `${refId}-${key}`
    const grouped = useMemo(() => {
        const groupedMetrics = groupAnnotationsByReferenceId(annotations)
        const result: Record<string, Record<string, AnnotationChipEntry>> = {}

        for (const [refId, metrics] of Object.entries(groupedMetrics)) {
            result[refId] = {}

            for (const [metricName, metricValue] of Object.entries(metrics)) {
                result[refId][metricName] = {
                    annotations: (metricValue.annotations || []) as {value: any; user: string}[],
                    average: metricValue.average,
                    category: "metric",
                }
            }
        }

        for (const annotation of annotations) {
            const refId = annotation.references?.evaluator?.slug
            if (!refId) continue

            if (!result[refId]) {
                result[refId] = {}
            }

            const outputs = (annotation.data?.outputs || {}) as Record<string, any>
            const categories: Array<[AnnotationCategory, Record<string, any>]> = [
                ["note", outputs.notes || {}],
                ["extra", outputs.extra || {}],
            ]

            for (const [category, values] of categories) {
                for (const [key, value] of Object.entries(values)) {
                    if (value === undefined || value === null) continue

                    if (!result[refId][key]) {
                        result[refId][key] = {
                            annotations: [],
                            category,
                        }
                    }

                    result[refId][key].annotations.push({
                        value,
                        user: annotation.createdBy || "",
                    })
                }
            }
        }

        return result
    }, [annotations])

    const hasAnnotations = useMemo(
        () =>
            Object.values(grouped).some((group) =>
                Object.values(group).some((entry) => entry.annotations.length > 0),
            ),
        [grouped],
    )

    const getSummaryValue = (metric: AnnotationChipEntry) => {
        if (metric.category === "metric") {
            // const values = metric.annotations.map((item) => item.value)
            // const allBooleans = values.every((value) => typeof value === "boolean")

            // if (allBooleans) {
            //     const trueCount = values.filter(Boolean).length
            //     const percentage = Math.round((trueCount / values.length) * 100)
            //     return `${percentage}% true`
            // }

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
            {Object.entries(grouped).map(([refId, metricsArr]) => {
                const filteredMetrics = Object.entries(metricsArr)
                    .filter(([, metric]) => metric.annotations.length > 0)
                    .sort(([a], [b]) => a.localeCompare(b))

                if (filteredMetrics.length === 0) return null

                return (
                    <div key={refId} className="flex flex-col gap-[6px]">
                        <Typography.Text type="secondary" className="text-[10px]">
                            {refId}
                        </Typography.Text>

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
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex flex-col overflow-hidden">
                                            <Typography.Text className="truncate">
                                                {key}
                                            </Typography.Text>
                                            {summaryValue ? (
                                                <Typography.Text
                                                    type="secondary"
                                                    className="truncate"
                                                >
                                                    {summaryValue}
                                                </Typography.Text>
                                            ) : null}
                                        </div>
                                        <Button
                                            type="text"
                                            icon={<CloseOutlined />}
                                            onClick={() => setIsAnnotationsPopoverOpen(null)}
                                        />
                                    </div>
                                )

                            return (
                                <div key={key}>
                                    <Popover
                                        overlayClassName={classes.annotationPopover}
                                        open={
                                            isAnnotationsPopoverOpen === getPopoverKey(refId, key)
                                        }
                                        onOpenChange={(open) => {
                                            setIsAnnotationsPopoverOpen(
                                                open ? getPopoverKey(refId, key) : null,
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
                                                        <Space
                                                            className="items-center justify-between"
                                                            key={i}
                                                        >
                                                            <UserAvatarTag
                                                                modifiedBy={annotation.user || ""}
                                                            />
                                                            <Typography.Text type="secondary">
                                                                {getStringOrJson(annotation.value)}
                                                            </Typography.Text>
                                                        </Space>
                                                    ),
                                                )}
                                            </div>
                                        }
                                    >
                                        <div
                                            className={clsx(
                                                "flex items-center flex-wrap gap-2 justify-between",
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
