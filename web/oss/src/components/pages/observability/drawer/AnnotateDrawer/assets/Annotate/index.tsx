import {useCallback, useEffect, useMemo, useState} from "react"

import {Collapse, CollapseProps, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

import {
    getInitialMetricsFromAnnotations,
    getInitialSelectedEvalMetrics,
    transformMetadata,
} from "../transforms"
import {AnnotateProps} from "../types"

import AnnotateCollapseContent from "./assets/AnnotateCollapseContent"

const Alert = dynamic(() => import("antd").then((mod) => mod.Alert), {ssr: false})

const Annotate = ({
    annotations = [],
    updatedMetrics = {},
    selectedEvaluators = [],
    tempSelectedEvaluators = [],
    errorMessage = [],
    disabled = false,
    setUpdatedMetrics,
    onCaptureError,
}: AnnotateProps) => {
    const {data: evaluators} = useEvaluators({
        preview: true,
    })

    // converting selected evaluator into useable metrics
    useEffect(() => {
        try {
            if (!selectedEvaluators.length || !evaluators?.length) return

            const metrics = getInitialSelectedEvalMetrics({
                evaluators: evaluators as EvaluatorDto[],
                selectedEvaluators,
            })

            setUpdatedMetrics((prev) => ({...prev, ...metrics}))
        } catch (error) {
            onCaptureError?.(["Invalid evaluator schema"])
        }
    }, [selectedEvaluators])

    // get metrics data from the selected annotation
    useEffect(() => {
        try {
            const _evaluators = evaluators?.filter(Boolean)
            if (!annotations.length || !_evaluators?.length) return

            const initialMetrics = getInitialMetricsFromAnnotations({
                annotations,
                evaluators: _evaluators as EvaluatorDto[],
            })

            setUpdatedMetrics((prev) => ({
                ...prev,
                ...initialMetrics,
            }))
        } catch (error) {
            onCaptureError?.(["Invalid evaluator schema"])
        }
    }, [annotations])

    // active collapse for the first open drawer
    useEffect(() => {
        const annEvalSlugs = annotations
            .map((ann) => ann.references?.evaluator?.slug)
            .filter(Boolean) as string[]

        const slugs = [...new Set([...annEvalSlugs, ...selectedEvaluators])]
        setActiveCollapse((prev) => [...new Set([...prev, ...slugs])])
    }, [annotations, selectedEvaluators])

    const handleCollapseChange = useCallback((keys: string[]) => {
        // Check if any dropdown is open by looking for the dropdown menu with the 'open' class
        // This is for improving micro interactions
        const openDropdowns = document.querySelectorAll(
            ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
        )
        if (openDropdowns.length > 0) {
            return
        }
        setActiveCollapse(keys)
    }, [])

    const handleMetricChange = useCallback((annSlug: string, metricKey: string, newValue: any) => {
        setUpdatedMetrics((prev) => ({
            ...prev,
            [annSlug]: {
                ...prev[annSlug],
                [metricKey]: {...prev[annSlug][metricKey], value: newValue},
            },
        }))
    }, [])

    const items: CollapseProps["items"] = useMemo(() => {
        const annotationItems = annotations.map((ann) => {
            const metrics = updatedMetrics[ann.references?.evaluator?.slug || ""] || {}
            const metadata = transformMetadata({data: metrics})

            return {
                key: ann.references?.evaluator?.slug || "",
                label: (
                    <div className="flex items-center justify-between">
                        <Typography.Text
                            className="capitalize truncate !w-[50%] text-start"
                            title={ann.meta?.name || ann.references?.evaluator?.slug}
                        >
                            {ann.meta?.name || ann.references?.evaluator?.slug}
                        </Typography.Text>
                        <Typography.Text
                            className="text-[#758391] truncate !w-[40%] text-end"
                            title={ann.references?.evaluator?.slug}
                        >
                            {ann.references?.evaluator?.slug}
                        </Typography.Text>
                    </div>
                ),
                children: (
                    <div className="flex flex-col gap-4">
                        {metadata.map((_meta) => {
                            const meta: Record<string, any> = {
                                ..._meta,
                                disabled,
                            }
                            return (
                                <AnnotateCollapseContent
                                    metadata={meta}
                                    key={meta.title}
                                    annSlug={ann.references?.evaluator?.slug || ""}
                                    onChange={handleMetricChange}
                                />
                            )
                        })}
                    </div>
                ),
            }
        })

        // Add evaluator-based items
        const evaluatorItems = ((evaluators || []) as EvaluatorDto[])
            .filter((evaluator) => selectedEvaluators.includes(evaluator.slug))
            .map((eva) => {
                const metrics = updatedMetrics[eva.slug || ""] || {}
                const metadata = transformMetadata({data: metrics})

                return {
                    key: eva.slug,
                    label: (
                        <div className="flex items-center justify-between text-start">
                            <Typography.Text
                                className="capitalize truncate !w-[50%]"
                                title={eva.name}
                            >
                                {eva.name}
                            </Typography.Text>
                            <Typography.Text
                                className="text-[#758391] truncate !w-[40%] text-end"
                                title={eva.slug}
                            >
                                {eva.slug}
                            </Typography.Text>
                        </div>
                    ),
                    children: (
                        <div className="flex flex-col gap-4">
                            {metadata.map((_meta) => {
                                const meta = {
                                    ..._meta,
                                    disabled,
                                } as Record<string, any>
                                return (
                                    <AnnotateCollapseContent
                                        metadata={meta}
                                        key={meta.title}
                                        annSlug={eva.slug}
                                        onChange={handleMetricChange}
                                    />
                                )
                            })}
                        </div>
                    ),
                }
            })

        // Combine and sort by evaluator order
        const allItems = [...evaluatorItems, ...annotationItems]
        const evaluatorOrder: Record<string, number> = {}
        evaluators?.forEach((ev: any, idx: number) => {
            evaluatorOrder[ev.slug] = idx
        })
        return allItems.slice().sort((a, b) => {
            const aKey = a.key || ""
            const bKey = b.key || ""
            return (evaluatorOrder[aKey] ?? 0) - (evaluatorOrder[bKey] ?? 0)
        })
    }, [annotations, updatedMetrics, evaluators, selectedEvaluators, disabled])

    const [activeCollapse, setActiveCollapse] = useState<string[]>(
        items.map((item) => item.key).filter(Boolean) as string[],
    )

    if (!annotations.length && !selectedEvaluators.length) {
        return (
            <div className="h-full flex items-center justify-center">
                <Typography.Text type="secondary">
                    There are no available annotations
                </Typography.Text>
            </div>
        )
    }

    return (
        <section className="w-full flex flex-col">
            {tempSelectedEvaluators.length > 0 && (
                <Alert
                    message="You have not added any human annotations from the web yet."
                    type="warning"
                    className="!rounded-none"
                    showIcon
                />
            )}

            {errorMessage && errorMessage?.length > 0
                ? errorMessage?.map((err, idx) => (
                      <Alert
                          showIcon
                          closable
                          key={idx}
                          message={err}
                          type="warning"
                          className="!rounded-none"
                          onClose={() =>
                              onCaptureError?.(
                                  errorMessage?.filter((_, i) => i !== idx) || [],
                                  false,
                              )
                          }
                      />
                  ))
                : null}

            <Collapse
                activeKey={activeCollapse}
                onChange={handleCollapseChange}
                items={items}
                defaultActiveKey={items.map((item) => item.key as string)}
                className={clsx(
                    "rounded-none",
                    "[&_.ant-collapse-content-box]:!p-0",
                    "[&_.ant-collapse-content]:!bg-white [&_.ant-collapse-content]:p-3",
                    "[&_.playground-property-control]:!mb-0",
                    "[&_.ant-slider]:!mb-0 [&_.ant-slider]:!mt-1",
                    "[&_.ant-collapse-header-text]:w-[95%]",
                )}
                bordered={false}
            />
        </section>
    )
}

export default Annotate
