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
import {Editor} from "@agenta/ui/editor"
import {ArrowSquareOut, Info} from "@phosphor-icons/react"
import {Alert, Button, Collapse, Popover, Typography} from "antd"
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
    /** Queue ID for submission */
    queueId: string
    /** Callback after successful save */
    onSaved?: () => void
    /** Callback after successful complete & advance */
    onCompleted?: (scenarioId: string) => void
}

const AnnotationPanel = memo(function AnnotationPanel({
    scenarioId,
    queueId,
    onSaved,
    onCompleted,
}: AnnotationPanelProps) {
    // Annotations and trace ref from session controller
    const annotations = useAtomValue(
        annotationSessionController.selectors.scenarioAnnotations(scenarioId),
    )
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )

    const {metrics, evaluators, updateMetric} = useAnnotationFormState({
        scenarioId,
        annotations,
        traceId: traceRef.traceId,
        spanId: traceRef.spanId,
    })

    const evaluatorIds = useAtomValue(annotationSessionController.selectors.evaluatorIds())
    const isSubmitting = useAtomValue(annotationFormController.selectors.isSubmitting(scenarioId))
    const isCompleted = useAtomValue(annotationSessionController.selectors.isCurrentCompleted())
    const submitAnnotations = useSetAtom(annotationFormController.actions.submitAnnotations)

    // Queue-level description shown in the helper popover
    const queueDescription = useAtomValue(annotationSessionController.selectors.queueDescription())
    const [errors, setErrors] = useState<string[]>([])

    // Reset errors when scenario changes
    useEffect(() => {
        setErrors([])
    }, [scenarioId])

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

    const handleCompleteAndAdvance = useCallback(async () => {
        try {
            setErrors([])
            await submitAnnotations({scenarioId, queueId, markComplete: true})
            onCompleted?.(scenarioId)
        } catch (err) {
            setErrors([(err as Error).message || "Failed to submit annotations"])
        }
    }, [submitAnnotations, scenarioId, queueId, onCompleted])

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
                            disabled={isSubmitting}
                            readOnly={isCompleted}
                            onFieldChange={handleFieldChange}
                        />
                    ),
                }
            })
    }, [evaluators, metrics, isSubmitting, isCompleted, handleFieldChange])

    const panelHeader = (
        <div className="flex items-center justify-between px-3 py-3 border-0 border-b border-solid border-[var(--ant-color-border-secondary)]">
            <div className="flex items-center gap-1">
                <Typography.Text className="font-medium">Annotations</Typography.Text>
                {queueDescription && (
                    <Popover
                        trigger="click"
                        placement="left"
                        destroyOnHidden
                        content={
                            <div
                                className="overflow-y-auto"
                                style={{
                                    width: "min(480px, calc(100vw - 250px))",
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
                        <Button type="text" size="small" icon={<Info size={14} />} />
                    </Popover>
                )}
            </div>
            <Button type="text" size="small" icon={<ArrowSquareOut size={14} />} />
        </div>
    )

    if (evaluators.length === 0 && evaluatorIds.length > 0) {
        return (
            <div className="flex flex-col h-full border-l border-solid border-[var(--ant-color-border-secondary)]">
                {panelHeader}
                <div className="flex-1 flex items-center justify-center p-4">
                    <Typography.Text type="secondary">Loading evaluators...</Typography.Text>
                </div>
            </div>
        )
    }

    if (evaluatorIds.length === 0) {
        return (
            <div className="flex flex-col h-full border-l border-solid border-[var(--ant-color-border-secondary)]">
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
            {errors.map((err, idx) => (
                <Alert
                    key={idx}
                    showIcon
                    closable
                    message={err}
                    type="warning"
                    className="!rounded-none"
                    onClose={() => setErrors((prev) => prev.filter((_, i) => i !== idx))}
                />
            ))}

            {/* Queue description helper + form fields */}
            <div className="flex-1 overflow-y-auto">
                <Collapse
                    activeKey={activeKeys}
                    onChange={handleCollapseChange}
                    items={collapseItems}
                    className="rounded-none [&_.ant-collapse-item]:!bg-white [&_.ant-collapse-header]:!bg-[#05172905] [&_.ant-collapse-content-box]:!p-0 [&_.ant-collapse-content]:!bg-white [&_.ant-collapse-content]:p-3 [&_.playground-property-control]:!mb-0 [&_.ant-slider]:!mb-0 [&_.ant-slider]:!mt-1"
                    bordered={false}
                />
            </div>

            {/* Annotate button */}
            <div className="px-3 py-3 border-0 border-t border-solid border-[var(--ant-color-border-secondary)]">
                <Button
                    type="primary"
                    block
                    onClick={handleCompleteAndAdvance}
                    disabled={isSubmitting || isCompleted}
                    loading={isSubmitting}
                >
                    {isCompleted ? "Completed" : "Annotate"}
                </Button>
            </div>
        </div>
    )
})

export default AnnotationPanel
