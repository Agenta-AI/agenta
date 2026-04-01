/**
 * AnnotationPanel
 *
 * Right panel in the annotation session that displays evaluator-derived
 * form fields grouped by evaluator. Supports save (without advancing)
 * and "Mark Complete & Next" (save + update scenario status + advance).
 *
 * Reads form state from `annotationFormController` selectors and dispatches
 * mutations via controller actions.
 *
 * Evaluator IDs, annotations, and trace/span refs are all derived
 * from controllers — no props needed for those.
 */

import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import type {AnnotationMetricField} from "@agenta/annotation"
import {message} from "@agenta/ui/app-message"
import {Editor} from "@agenta/ui/editor"
import {Info} from "@phosphor-icons/react"
import {Alert, Button, Collapse, Popover, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationFormState} from "../../hooks/useAnnotationFormState"

import AnnotationFormField from "./AnnotationFormField"

// ============================================================================
// EVALUATOR SECTION
// ============================================================================

const EvaluatorSection = memo(function EvaluatorSection({
    slug,
    metricFields,
    disabled,
    readOnly,
    onFieldChange,
}: {
    slug: string
    metricFields: Record<string, AnnotationMetricField>
    disabled?: boolean
    readOnly?: boolean
    onFieldChange: (slug: string, fieldKey: string, value: unknown) => void
}) {
    const handleChange = useCallback(
        (fieldKey: string) => (value: unknown) => {
            onFieldChange(slug, fieldKey, value)
        },
        [onFieldChange, slug],
    )

    const fieldEntries = useMemo(() => Object.entries(metricFields), [metricFields])

    if (fieldEntries.length === 0) {
        return (
            <Typography.Text type="secondary" className="text-sm py-2 block">
                No annotation fields available
            </Typography.Text>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            {fieldEntries.map(([fieldKey, field]) => (
                <AnnotationFormField
                    key={fieldKey}
                    fieldKey={fieldKey}
                    field={field}
                    disabled={disabled}
                    readOnly={readOnly}
                    onChange={handleChange(fieldKey)}
                />
            ))}
        </div>
    )
})

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface AnnotationPanelProps {
    /** Current scenario ID */
    scenarioId: string
    /** Queue ID — when provided together with onCompleted, shows a "Mark completed" button */
    queueId?: string
    /** Callback when scenario is marked complete */
    onCompleted?: (scenarioId: string) => void
    showMarkComplete?: boolean
}

const AnnotationPanel = memo(function AnnotationPanel({
    scenarioId,
    queueId,
    onCompleted,
    showMarkComplete,
}: AnnotationPanelProps) {
    // Annotations and trace ref from session controller
    const annotations = useAtomValue(
        annotationSessionController.selectors.scenarioAnnotations(scenarioId),
    )
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )

    const {metrics, evaluators, updateMetric} = useAnnotationFormState({
        scenarioId,
        annotations,
        traceId: traceRef.traceId,
        spanId: traceRef.spanId,
        testcaseId: testcaseRef.testcaseId,
    })

    const evaluatorIds = useAtomValue(annotationSessionController.selectors.evaluatorIds())
    const scenarioStatuses = useAtomValue(annotationSessionController.selectors.scenarioStatuses())
    const isCompleted = scenarioStatuses[scenarioId] === "success"

    // Queue-level description shown in the helper popover
    const queueDescription = useAtomValue(annotationSessionController.selectors.queueDescription())
    const submitError = useAtomValue(annotationFormController.selectors.submitError(scenarioId))
    const clearSubmitError = useSetAtom(annotationFormController.actions.clearSubmitError)

    // Mark-complete button state (only used when queueId is provided)

    const isSubmitting = useAtomValue(annotationFormController.selectors.isSubmitting(scenarioId))
    const hasFilledMetrics = useAtomValue(
        annotationFormController.selectors.hasFilledMetrics(scenarioId),
    )
    const submitAnnotations = useSetAtom(annotationFormController.actions.submitAnnotations)

    const handleMarkComplete = useCallback(async () => {
        if (!queueId) return
        try {
            await submitAnnotations({scenarioId, queueId, markComplete: true})
            onCompleted?.(scenarioId)
        } catch (err) {
            message.error((err as Error).message || "Failed to submit annotations")
        }
    }, [submitAnnotations, scenarioId, queueId, onCompleted])

    // Build collapse items from evaluators
    const evaluatorSlugs = useMemo(
        () => evaluators.map((e) => e.slug).filter(Boolean) as string[],
        [evaluators],
    )
    const [activeKeys, setActiveKeys] = useState<string[]>(evaluatorSlugs)

    useEffect(() => {
        setActiveKeys(evaluatorSlugs)
    }, [evaluatorSlugs])

    const handleCollapseChange = useCallback((keys: string | string[]) => {
        setActiveKeys(Array.isArray(keys) ? keys : [keys])
    }, [])

    const handleFieldChange = useCallback(
        (slug: string, fieldKey: string, value: unknown) => {
            updateMetric({slug, fieldKey, value})
        },
        [updateMetric],
    )

    const collapseItems = useMemo(() => {
        return evaluators
            .filter((e) => e.slug)
            .map((evaluator) => {
                const slug = evaluator.slug as string
                const metricFields = metrics[slug] ?? {}

                return {
                    key: slug,
                    label: (
                        <div className="flex items-center justify-between w-full">
                            <Typography.Text
                                className="truncate max-w-[50%] text-start"
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
                        <EvaluatorSection
                            slug={slug}
                            metricFields={metricFields}
                            readOnly={isCompleted}
                            onFieldChange={handleFieldChange}
                        />
                    ),
                }
            })
    }, [evaluators, metrics, isCompleted, handleFieldChange])

    const panelHeader = (
        <div className="flex items-center justify-between px-3 py-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
            <div className="flex items-center gap-1">
                <Typography.Text className="font-medium">Annotations</Typography.Text>
                {queueDescription && (
                    <Popover
                        trigger="click"
                        placement="bottomLeft"
                        destroyOnHidden
                        content={
                            <div
                                className="overflow-y-auto"
                                style={{
                                    width: "min(350px, calc(100vw - 250px))",
                                    maxHeight: "min(320px, calc(100vh - 160px))",
                                }}
                            >
                                <Editor
                                    id="annotation-panel-description"
                                    initialValue={queueDescription}
                                    disabled
                                    showToolbar={false}
                                    showBorder={false}
                                    enableTokens={false}
                                    showMarkdownToggleButton={false}
                                />
                            </div>
                        }
                    >
                        <Button
                            type="text"
                            size="small"
                            icon={<Info size={14} />}
                            className="!text-[#758391] !w-6 !h-6 !min-w-0 !p-0"
                        />
                    </Popover>
                )}
            </div>
            <Tag color={isCompleted ? "green" : "orange"}>
                {isCompleted ? "Completed" : "Incomplete"}
            </Tag>
        </div>
    )

    if (evaluators.length === 0 && evaluatorIds.length > 0) {
        return (
            <div className="flex flex-col h-full">
                {panelHeader}
                <div className="flex-1 flex items-center justify-center p-4">
                    <Typography.Text type="secondary">Loading evaluators...</Typography.Text>
                </div>
            </div>
        )
    }

    if (evaluatorIds.length === 0) {
        return (
            <div className="flex flex-col h-full">
                {panelHeader}
                <div className="flex-1 flex items-center justify-center p-4">
                    <Typography.Text type="secondary">
                        No evaluators configured for this queue
                    </Typography.Text>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            {panelHeader}

            {/* Errors */}
            {submitError && (
                <Alert
                    showIcon
                    closable
                    message={submitError}
                    type="warning"
                    className="!rounded-none"
                    onClose={() => clearSubmitError(scenarioId)}
                />
            )}

            {/* Evaluator form fields */}
            <div className="flex-1 overflow-y-auto">
                <Collapse
                    activeKey={activeKeys}
                    onChange={handleCollapseChange}
                    items={collapseItems}
                    className="rounded-none [&_.ant-collapse-item]:!bg-white [&_.ant-collapse-header]:!bg-[#05172905] [&_.ant-collapse-content-box]:!p-0 [&_.ant-collapse-content]:!bg-white [&_.ant-collapse-content]:p-3 [&_.playground-property-control]:!mb-0 [&_.ant-slider]:!mb-0 [&_.ant-slider]:!mt-1"
                    bordered={false}
                />
            </div>

            {/* Mark completed button (drawer mode) */}
            {showMarkComplete && (
                <div className="shrink-0 border-0 border-t border-solid border-[rgba(5,23,41,0.06)] px-3 py-3">
                    <Button
                        type="primary"
                        block
                        onClick={handleMarkComplete}
                        disabled={isSubmitting || isCompleted || !hasFilledMetrics}
                        loading={isSubmitting}
                    >
                        {isCompleted ? "Completed" : "Mark completed"}
                    </Button>
                </div>
            )}
        </div>
    )
})

export default AnnotationPanel
