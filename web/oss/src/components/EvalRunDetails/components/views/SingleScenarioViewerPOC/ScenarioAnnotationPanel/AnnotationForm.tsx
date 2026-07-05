import {useCallback, useEffect, useMemo, useState} from "react"

import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Warning} from "@phosphor-icons/react"
import {Collapse} from "antd"
import clsx from "clsx"

import {transformMetadata} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/transforms"

import type {AnnotationMetrics, EvaluatorDto} from "../types"

import {AnnotationFieldRenderer} from "./AnnotationInputs"

interface AnnotationFormProps {
    evaluators: EvaluatorDto[]
    metrics: AnnotationMetrics
    errors: string[]
    disabled?: boolean
    onMetricChange: (slug: string, fieldKey: string, value: unknown) => void
    onDismissError: (index: number) => void
}

const AnnotationForm = ({
    evaluators,
    metrics,
    errors,
    disabled = false,
    onMetricChange,
    onDismissError,
}: AnnotationFormProps) => {
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
    const handleMetricChange = useCallback(
        (annSlug: string, metricKey: string, newValue: unknown) => {
            onMetricChange(annSlug, metricKey, newValue)
        },
        [onMetricChange],
    )

    // Build collapse items from evaluators
    const items = useMemo(() => {
        return evaluators
            .filter((e) => e.slug)
            .map((evaluator) => {
                const slug = evaluator.slug
                const metricFields = metrics[slug] ?? {}

                // Use transformMetadata to convert metrics to the format expected by AnnotationFieldRenderer
                const metadata = transformMetadata({data: metricFields})

                return {
                    key: slug,
                    label: (
                        <div className="flex items-center justify-between w-full">
                            <span
                                className="capitalize truncate max-w-[50%] text-start"
                                title={evaluator.name ?? slug}
                            >
                                {evaluator.name ?? slug}
                            </span>
                            <span
                                className="text-[var(--ag-c-758391)] truncate max-w-[40%] text-end"
                                title={slug}
                            >
                                {slug}
                            </span>
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
                                <span className="text-sm text-muted-foreground">
                                    No annotation fields available
                                </span>
                            )}
                        </div>
                    ),
                }
            })
    }, [evaluators, metrics, disabled, handleMetricChange])

    if (evaluators.length === 0) {
        return (
            <div className="h-full flex items-center justify-center py-4">
                <span className="text-muted-foreground">
                    No human evaluators configured for this run
                </span>
            </div>
        )
    }

    return (
        <section className="w-full flex flex-col">
            {errors.map((err, idx) => (
                <Alert
                    key={idx}
                    variant="warning"
                    icon={<Warning size={16} />}
                    closable
                    onClose={() => onDismissError(idx)}
                    className="!rounded-none"
                >
                    <AlertTitle>{err}</AlertTitle>
                </Alert>
            ))}

            <Collapse
                activeKey={activeKeys}
                onChange={handleCollapseChange}
                items={items}
                className={clsx(
                    "rounded-none",
                    "[&_.ant-collapse-content-box]:!p-0",
                    "[&_.ant-collapse-content]:!bg-[var(--ag-c-FFFFFF)] [&_.ant-collapse-content]:p-3",
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
