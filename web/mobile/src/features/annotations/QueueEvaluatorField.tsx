import {useCallback, useMemo} from "react"

import {
    formatHumanMetricLabel,
    getHumanMetrics,
    type WorkflowRevisionLike,
} from "@agenta/annotation"
import {evaluatorWorkflowMetaMapAtom} from "@agenta/entities/workflow"
import {
    EntityPicker,
    useEnrichedHumanEvaluatorAdapter,
    useEnsureEvaluatorEnrichment,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {Field} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import type {SelectedEvaluator} from "./createQueueTypes"
import {SelectedEvaluatorCard} from "./SelectedEvaluatorCard"

type EvaluatorSelection = WorkflowRevisionSelectionResult & {
    metadata: WorkflowRevisionSelectionResult["metadata"] & {
        workflowId?: string
        isHuman?: boolean
    }
}

const metricSummary = (labels: string[]) =>
    labels.length <= 3
        ? labels.join(", ")
        : `${labels.slice(0, 3).join(", ")} +${labels.length - 3}`

const renderRevisionLabel = (entity: unknown) => {
    const revision = entity as WorkflowRevisionLike
    const metrics = revision.flags?.is_feedback ? getHumanMetrics(revision) : []
    const labels = metrics.map(formatHumanMetricLabel)
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
                <span className="max-w-[180px] truncate" title={revision.name ?? undefined}>
                    {revision.name ?? "Unnamed"}
                </span>
                <VersionBadge version={revision.version ?? 0} variant="chip" size="small" />
            </div>
            {labels.length > 0 ? (
                <span className="truncate text-xs text-muted-foreground" title={labels.join(", ")}>
                    {metricSummary(labels)}
                </span>
            ) : null}
        </div>
    )
}

/** The "Feedback" field: the evaluator picker and a card for each evaluator picked. */
export const QueueEvaluatorField = ({
    selected,
    onChange,
    error,
    disabled,
}: {
    selected: SelectedEvaluator[]
    onChange: (next: SelectedEvaluator[]) => void
    error?: string
    disabled?: boolean
}) => {
    // The sheet mounts this only while open, so the revision counts load only then.
    useEnsureEvaluatorEnrichment()
    const metaMap = useAtomValue(evaluatorWorkflowMetaMapAtom)
    const adapter = useEnrichedHumanEvaluatorAdapter(renderRevisionLabel, {showWorkflowMeta: true})

    const selectedRevisionIds = useMemo(
        () => new Set(selected.map((evaluator) => evaluator.revisionId)),
        [selected],
    )
    const selectedByEvaluator = useMemo(() => {
        const map = new Map<string, {id: string; label: string}[]>()
        for (const evaluator of [...selected].sort((a, b) => b.version - a.version)) {
            const list = map.get(evaluator.evaluatorId) ?? []
            list.push({id: evaluator.revisionId, label: `v${evaluator.version}`})
            map.set(evaluator.evaluatorId, list)
        }
        return map
    }, [selected])
    const totalByEvaluator = useMemo(() => {
        const map = new Map<string, number>()
        for (const [evaluatorId, meta] of metaMap) {
            if (meta.versionCount != null) map.set(evaluatorId, meta.versionCount)
        }
        return map
    }, [metaMap])

    const handleSelect = useCallback(
        (result: WorkflowRevisionSelectionResult) => {
            const {id, metadata} = result as EvaluatorSelection
            if (selected.some((evaluator) => evaluator.revisionId === id)) {
                onChange(selected.filter((evaluator) => evaluator.revisionId !== id))
                return
            }
            onChange([
                ...selected,
                {
                    evaluatorId: metadata.workflowId || "",
                    revisionId: id,
                    evaluatorName: metadata.workflowName || "Evaluator",
                    version: metadata.revision ?? 0,
                    isHuman: Boolean(metadata.isHuman),
                },
            ])
        },
        [onChange, selected],
    )
    const remove = useCallback(
        (revisionId: string) =>
            onChange(selected.filter((evaluator) => evaluator.revisionId !== revisionId)),
        [onChange, selected],
    )

    return (
        <Field label="Feedback" required error={error} htmlFor="queue-evaluator">
            <div className="flex flex-col gap-3">
                <div id="queue-evaluator" className="w-full min-w-0">
                    <EntityPicker<WorkflowRevisionSelectionResult>
                        variant="popover-cascader"
                        adapter={adapter}
                        onSelect={handleSelect}
                        instanceId="queue-evaluator"
                        className="!w-full !justify-start"
                        placeholder="Add evaluator"
                        icon={<PlusIcon size={14} />}
                        showDropdownIcon={false}
                        panelMinWidth={280}
                        disabled={disabled}
                        openChildOnHover
                        multiSelect
                        selectedChildIds={selectedRevisionIds}
                        selectionSummary
                        showParentCheckboxes
                        selectedChildrenByParent={selectedByEvaluator}
                        totalChildrenByParent={totalByEvaluator}
                        onDeselectChild={remove}
                        showParentDescription
                        showChildSelectAll
                        onClearAll={() => onChange([])}
                        size="middle"
                    />
                </div>
                {selected.map((evaluator) => (
                    <SelectedEvaluatorCard
                        key={evaluator.revisionId}
                        evaluator={evaluator}
                        disabled={disabled}
                        onRemove={remove}
                    />
                ))}
            </div>
        </Field>
    )
}
