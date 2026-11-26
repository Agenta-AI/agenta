import {useCallback, useMemo, useState} from "react"

import {
    formatHumanMetricLabel,
    getHumanMetrics,
    type WorkflowRevisionLike,
} from "@agenta/annotation"
import {evaluatorWorkflowMetaMapAtom, workflowMolecule} from "@agenta/entities/workflow"
import {
    EntityPicker,
    useEnrichedHumanEvaluatorAdapter,
    useEnsureEvaluatorEnrichment,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {Field} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import type {SelectedEvaluator} from "./createQueueTypes"
import {SelectedEvaluatorCard} from "./SelectedEvaluatorCard"

// The create form is its own chunk: it downloads only when a user creates an evaluator here.
const CreateEvaluatorFlow = dynamic(
    () => import("../evaluators/create/CreateEvaluatorFlow").then((m) => m.CreateEvaluatorFlow),
    {ssr: false},
)

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

/** The evaluator's own name: a revision's name can read "default" or be empty. */
const RevisionName = ({revisionId}: {revisionId: string}) => {
    const name = useAtomValue(workflowMolecule.selectors.artifactName(revisionId))
    return (
        <span className="max-w-[180px] truncate" title={name ?? undefined}>
            {name ?? "Unnamed"}
        </span>
    )
}

const renderRevisionLabel = (entity: unknown) => {
    const revision = entity as WorkflowRevisionLike & {id: string}
    const metrics = revision.flags?.is_feedback ? getHumanMetrics(revision) : []
    const labels = metrics.map(formatHumanMetricLabel)
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
                <RevisionName revisionId={revision.id} />
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

/**
 * The "Feedback" field: the evaluator picker and a card for each evaluator picked. In beta
 * developer mode the picker also offers "Create evaluator", which opens the human evaluator form
 * and adds the new evaluator here.
 */
export const QueueEvaluatorField = ({
    selected,
    onChange,
    error,
    disabled,
}: {
    selected: SelectedEvaluator[]
    // An updater, so several picks in one tick each build on the latest list.
    onChange: (update: (previous: SelectedEvaluator[]) => SelectedEvaluator[]) => void
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
            onChange((previous) =>
                previous.some((evaluator) => evaluator.revisionId === id)
                    ? previous.filter((evaluator) => evaluator.revisionId !== id)
                    : [
                          ...previous,
                          {
                              evaluatorId: metadata.workflowId || "",
                              revisionId: id,
                              evaluatorName: metadata.workflowName || "Evaluator",
                              version: metadata.revision ?? 0,
                              isHuman: Boolean(metadata.isHuman),
                          },
                      ],
            )
        },
        [onChange],
    )
    const canCreate = useAtomValue(betaDeveloperModeActiveAtom)
    const [creating, setCreating] = useState(false)
    const remove = useCallback(
        (revisionId: string) =>
            onChange((previous) =>
                previous.filter((evaluator) => evaluator.revisionId !== revisionId),
            ),
        [onChange],
    )

    return (
        <>
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
                            onClearAll={() => onChange(() => [])}
                            onCreateNew={canCreate ? () => setCreating(true) : undefined}
                            createNewLabel="Create evaluator"
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
            {creating ? (
                <CreateEvaluatorFlow
                    kind="human"
                    onClose={() => setCreating(false)}
                    onCreated={(created) =>
                        onChange((previous) => [
                            ...previous,
                            {
                                evaluatorId: created.workflowId,
                                revisionId: created.revisionId,
                                evaluatorName: created.name,
                                version: created.version,
                                isHuman: true,
                            },
                        ])
                    }
                />
            ) : null}
        </>
    )
}
