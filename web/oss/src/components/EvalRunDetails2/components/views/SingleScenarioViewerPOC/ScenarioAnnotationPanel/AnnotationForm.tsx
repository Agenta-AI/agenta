import {useCallback, useEffect, useMemo, useState} from "react"

import {Alert, Collapse, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {transformMetadata} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"

import {AnnotationFieldRenderer} from "./AnnotationInputs"
import {
    currentErrorsAtom,
    dismissErrorAtom,
    effectiveMetricsAtom,
    evaluatorsAtom,
    updateMetricAtom,
} from "./atoms"

interface AnnotationFormProps {
    scenarioId: string
    disabled?: boolean
}

const AnnotationForm = ({scenarioId, disabled = false}: AnnotationFormProps) => {
    const evaluators = useAtomValue(evaluatorsAtom)
    const metrics = useAtomValue(effectiveMetricsAtom)
    const errors = useAtomValue(currentErrorsAtom)
    const updateMetric = useSetAtom(updateMetricAtom)
    const dismissError = useSetAtom(dismissErrorAtom)

    // Track active collapse panels - compute from evaluators
    const evaluatorSlugs = useMemo(
        () => evaluators.map((e) => e.slug).filter(Boolean),
        [evaluators],
    )
    const [activeKeys, setActiveKeys] = useState<string[]>(evaluatorSlugs)

    // Update active keys when evaluators change (e.g., navigating scenarios)
    useEffect(() => {
        setActiveKeys(evaluatorSlugs)
    }, [evaluatorSlugs])

    const handleCollapseChange = useCallback((keys: string | string[]) => {
        setActiveKeys(Array.isArray(keys) ? keys : [keys])
    }, [])

    // Handle metric change - adapts the AnnotateCollapseContent onChange signature
    // Include scenarioId to prevent stale debounced updates from affecting wrong scenario
    const handleMetricChange = useCallback(
        (annSlug: string, metricKey: string, newValue: unknown) => {
            updateMetric({scenarioId, slug: annSlug, fieldKey: metricKey, value: newValue})
        },
        [updateMetric, scenarioId],
    )

    // Build collapse items from evaluators using the same approach as the original Annotate component
    const items = useMemo(() => {
        return evaluators
            .filter((e) => e.slug)
            .map((evaluator) => {
                const slug = evaluator.slug
                const metricFields = metrics[slug] ?? {}

                // Use transformMetadata to convert metrics to the format expected by AnnotateCollapseContent
                const metadata = transformMetadata({data: metricFields})

                return {
                    key: slug,
                    label: (
                        <div className="flex items-center justify-between w-full">
                            <Typography.Text
                                className="capitalize truncate max-w-[50%] text-start"
                                title={evaluator.name ?? slug}
                            >
                                {evaluator.name ?? slug}
                            </Typography.Text>
                            <Typography.Text
                                className="text-[#758391] truncate max-w-[40%] text-end"
                                title={slug}
                            >
                                {slug}
                            </Typography.Text>
                        </div>
                    ),
                    children: (
                        <div className="flex flex-col gap-4">
                            {metadata.length > 0 ? (
                                metadata.map((metaItem) => {
                                    const meta = {
                                        ...metaItem,
                                        disabled,
                                    }
                                    return (
                                        <AnnotationFieldRenderer
                                            key={metaItem?.title ?? ""}
                                            metadata={meta as any}
                                            annSlug={slug}
                                            onChange={handleMetricChange}
                                        />
                                    )
                                })
                            ) : (
                                <Typography.Text type="secondary" className="text-sm">
                                    No annotation fields available
                                </Typography.Text>
                            )}
                        </div>
                    ),
                }
            })
    }, [evaluators, metrics, disabled, handleMetricChange])

    if (evaluators.length === 0) {
        return (
            <div className="h-full flex items-center justify-center py-4">
                <Typography.Text type="secondary">
                    No human evaluators configured for this run
                </Typography.Text>
            </div>
        )
    }

    return (
        <section className="w-full flex flex-col">
            {errors.map((err, idx) => (
                <Alert
                    key={idx}
                    showIcon
                    closable
                    message={err}
                    type="warning"
                    className="!rounded-none"
                    onClose={() => dismissError(idx)}
                />
            ))}

            <Collapse
                activeKey={activeKeys}
                onChange={handleCollapseChange}
                items={items}
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

export default AnnotationForm
