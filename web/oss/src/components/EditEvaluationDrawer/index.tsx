import {useCallback, useEffect, useMemo, useState} from "react"

import type {EvaluatorDefinition} from "@agenta/entities/workflow"
import {
    EntityPicker,
    useEnrichedEvaluatorOnlyAdapter,
    useEnrichedHumanEvaluatorAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {VersionBadge} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {Plus, Trash} from "@phosphor-icons/react"
import {Button, Input, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {saveEvaluationEditAtom} from "@/oss/components/EvalRunDetails/atoms/mutations/editEvaluation"
import {
    evaluationEvaluatorsByRunQueryAtomFamily,
    evaluatorDefinitionByRevisionQueryAtomFamily,
} from "@/oss/components/EvalRunDetails/atoms/table/evaluators"
import {evaluationRunQueryAtomFamily} from "@/oss/components/EvalRunDetails/atoms/table/run"
import {derivedEvalTypeAtomFamily} from "@/oss/components/EvalRunDetails/state/evalType"

const {Text} = Typography

/**
 * Shared "Edit evaluation" drawer. A true edit form: name, description, and the
 * evaluators section (see what's connected, stage more). Designed to grow more
 * config sections later.
 *
 * Changes are STAGED locally and applied only on Update (dirty-gated) — selecting an
 * evaluator does not auto-save. Triggered from BOTH the evaluations table rows and the
 * run-details Configuration page; render it ONCE at each surface's parent (never inside
 * a virtualized table cell) and drive it with `runId`/`open`.
 *
 * The add control is the same entity-ui `popover-cascader` EntityPicker the playground
 * uses to connect evaluators, kind-scoped to the run; already-connected/staged
 * evaluators are disabled. Save goes through `saveEvaluationEditAtom`.
 */
interface EditEvaluationDrawerProps {
    runId: string | null
    open: boolean
    onClose: () => void
}

const EditEvaluationDrawer = ({runId, open, onClose}: EditEvaluationDrawerProps) => {
    const runQuery = useAtomValue(evaluationRunQueryAtomFamily(runId))
    const rawRun = runQuery?.data?.rawRun as {name?: string; description?: string} | undefined
    const serverName = rawRun?.name ?? ""
    const serverDescription = rawRun?.description ?? ""

    const evalType = useAtomValue(derivedEvalTypeAtomFamily(runId))
    const isHuman = evalType === "human"
    const evaluatorsQuery = useAtomValue(evaluationEvaluatorsByRunQueryAtomFamily(runId))
    const connected = (evaluatorsQuery.data as EvaluatorDefinition[] | undefined) ?? []

    const save = useSetAtom(saveEvaluationEditAtom)

    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [pending, setPending] = useState<WorkflowRevisionSelectionResult[]>([])
    const [ready, setReady] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    // Seed the draft from the run once per open (after the run has loaded).
    useEffect(() => {
        if (!open) {
            setReady(false)
            return
        }
        if (!ready && rawRun) {
            setName(serverName)
            setDescription(serverDescription)
            setPending([])
            setReady(true)
        }
    }, [open, ready, rawRun, serverName, serverDescription])

    const disabledRevisionIds = useMemo(
        () =>
            new Set<string>([
                ...(connected.map((evaluator) => evaluator.id).filter(Boolean) as string[]),
                ...pending.map((selection) => selection.id),
            ]),
        [connected, pending],
    )

    const isDirty =
        ready && (name !== serverName || description !== serverDescription || pending.length > 0)

    const handleStage = useCallback((selection: WorkflowRevisionSelectionResult) => {
        setPending((prev) =>
            prev.some((existing) => existing.id === selection.id) ? prev : [...prev, selection],
        )
    }, [])

    const handleUnstage = useCallback((revisionId: string) => {
        setPending((prev) => prev.filter((selection) => selection.id !== revisionId))
    }, [])

    const handleUpdate = useCallback(async () => {
        if (!runId || !isDirty || submitting) return
        setSubmitting(true)
        try {
            await save({
                runId,
                name: name.trim(),
                description,
                addedEvaluatorRevisionIds: pending.map((selection) => selection.id),
            })
            message.success("Evaluation updated")
            onClose()
        } catch (error) {
            console.error("[edit-evaluation] update failed", error)
            message.error("Failed to update evaluation. Please try again.")
        } finally {
            setSubmitting(false)
        }
    }, [runId, isDirty, submitting, save, name, description, pending, onClose])

    return (
        <EnhancedDrawer
            title="Edit evaluation"
            open={open}
            onClose={onClose}
            width={520}
            destroyOnHidden
            closeOnLayoutClick={false}
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    <Button onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        type="primary"
                        onClick={handleUpdate}
                        loading={submitting}
                        disabled={!isDirty}
                    >
                        Update
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <Text strong>Name</Text>
                    <Input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Evaluation name"
                        disabled={!ready}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <Text strong>Description</Text>
                    <Input.TextArea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Add a description"
                        rows={3}
                        disabled={!ready}
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                        <Text strong>Evaluators</Text>
                        <Text type="secondary" className="text-xs">
                            Add an evaluator to score this run&apos;s existing outputs. New scores
                            fill in without re-running the app.
                        </Text>
                    </div>

                    {connected.map((evaluator) => (
                        <ConnectedEvaluatorCard key={evaluator.id} evaluator={evaluator} />
                    ))}
                    {pending.map((selection) => (
                        <PendingEvaluatorCard
                            key={selection.id}
                            selection={selection}
                            onRemove={handleUnstage}
                        />
                    ))}
                    {connected.length === 0 && pending.length === 0 ? (
                        <Text type="secondary" className="text-xs">
                            No evaluators connected yet.
                        </Text>
                    ) : null}

                    {open && runId ? (
                        isHuman ? (
                            <HumanEvaluatorPicker
                                onSelect={handleStage}
                                disabledRevisionIds={disabledRevisionIds}
                            />
                        ) : (
                            <AutoEvaluatorPicker
                                onSelect={handleStage}
                                disabledRevisionIds={disabledRevisionIds}
                            />
                        )
                    ) : null}
                </div>
            </div>
        </EnhancedDrawer>
    )
}

/** Output-metric chips, shared by connected + pending cards. */
const EvaluatorMetricTags = ({
    metrics,
}: {
    metrics: EvaluatorDefinition["metrics"] | null | undefined
}) => {
    const list = Array.isArray(metrics) ? metrics : []
    if (list.length === 0) {
        return (
            <Text type="secondary" className="text-xs">
                No output metrics
            </Text>
        )
    }
    return (
        <div className="flex flex-wrap gap-1">
            {list.map((metric) => (
                <Tag key={metric.name} className="!m-0 !text-xs">
                    {metric.name}
                    {metric.metricType ? (
                        <span className="ml-1 opacity-60">{metric.metricType}</span>
                    ) : null}
                </Tag>
            ))}
        </div>
    )
}

const ConnectedEvaluatorCard = ({evaluator}: {evaluator: EvaluatorDefinition}) => (
    <div className="flex flex-col gap-2 rounded-lg border border-solid border-[var(--ag-c-EAECF0)] px-3 py-2.5">
        <div className="flex items-center gap-2">
            <Text className="truncate text-xs font-medium">
                {evaluator.name ?? evaluator.slug ?? "Evaluator"}
            </Text>
            {typeof evaluator.version === "number" ? (
                <VersionBadge version={evaluator.version} variant="chip" size="small" />
            ) : evaluator.version ? (
                <Text type="secondary" className="text-xs">
                    v{evaluator.version}
                </Text>
            ) : null}
        </div>
        <EvaluatorMetricTags metrics={evaluator.metrics} />
    </div>
)

const PendingEvaluatorCard = ({
    selection,
    onRemove,
}: {
    selection: WorkflowRevisionSelectionResult
    onRemove: (revisionId: string) => void
}) => {
    const {definition, isPending} = useAtomValue(
        evaluatorDefinitionByRevisionQueryAtomFamily(selection.id),
    )
    const revision = selection.metadata?.revision
    const name =
        definition?.name ?? selection.label ?? selection.metadata?.workflowName ?? "Evaluator"
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--ag-c-EAECF0)] px-3 py-2.5">
            <div className="flex items-center gap-2">
                <Text className="truncate text-xs font-medium">{name}</Text>
                {typeof revision === "number" ? (
                    <VersionBadge version={revision} variant="chip" size="small" />
                ) : null}
                <Tag color="processing" className="!m-0 !text-xs">
                    Pending
                </Tag>
                <Button
                    type="text"
                    size="small"
                    danger
                    className="ml-auto shrink-0"
                    aria-label="Remove staged evaluator"
                    icon={<Trash size={14} />}
                    onClick={() => onRemove(selection.id)}
                />
            </div>
            {isPending ? (
                <Text type="secondary" className="text-xs">
                    Loading metrics…
                </Text>
            ) : (
                <EvaluatorMetricTags metrics={definition?.metrics} />
            )}
        </div>
    )
}

interface PickerProps {
    onSelect: (selection: WorkflowRevisionSelectionResult) => void
    disabledRevisionIds: Set<string>
}

const AutoEvaluatorPicker = ({onSelect, disabledRevisionIds}: PickerProps) => {
    const adapter = useEnrichedEvaluatorOnlyAdapter()
    return (
        <EntityPicker<WorkflowRevisionSelectionResult>
            variant="popover-cascader"
            adapter={adapter}
            onSelect={onSelect}
            instanceId="edit-evaluation-add-auto-evaluator"
            placeholder="Add evaluator"
            icon={<Plus size={14} />}
            showDropdownIcon={false}
            disabledChildIds={disabledRevisionIds}
            disabledChildTooltip="Already added to this run"
            size="small"
        />
    )
}

const HumanEvaluatorPicker = ({onSelect, disabledRevisionIds}: PickerProps) => {
    const adapter = useEnrichedHumanEvaluatorAdapter()
    return (
        <EntityPicker<WorkflowRevisionSelectionResult>
            variant="popover-cascader"
            adapter={adapter}
            onSelect={onSelect}
            instanceId="edit-evaluation-add-human-evaluator"
            placeholder="Add evaluator"
            icon={<Plus size={14} />}
            showDropdownIcon={false}
            disabledChildIds={disabledRevisionIds}
            disabledChildTooltip="Already added to this run"
            size="small"
        />
    )
}

export default EditEvaluationDrawer
