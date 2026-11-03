import {useMemo} from "react"

import {evaluatorWorkflowMetaMapAtom} from "@agenta/entities/workflow"
import {
    EntityPicker,
    type useEnrichedEvaluatorOnlyAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {PlusIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import type {DraftEvaluator} from "./newEvaluationDraft"

type EvaluatorAdapter = ReturnType<typeof useEnrichedEvaluatorOnlyAdapter>

type EvaluatorSelection = WorkflowRevisionSelectionResult & {
    metadata: WorkflowRevisionSelectionResult["metadata"] & {isHuman?: boolean}
}

const toDraftEvaluator = (result: WorkflowRevisionSelectionResult): DraftEvaluator => {
    const {id, metadata} = result as EvaluatorSelection
    return {
        revisionId: id,
        evaluatorId: metadata.workflowId || "",
        name: metadata.workflowName || "Evaluator",
        version: metadata.revision ?? 0,
        isHuman: Boolean(metadata.isHuman),
    }
}

/** The evaluator picker: one popover with the evaluators and their revisions, several picks. */
export const EvaluatorPicker = ({
    adapter,
    instanceId,
    selected,
    disabled,
    onPick,
    onRemove,
    onClear,
}: {
    adapter: EvaluatorAdapter
    instanceId: string
    selected: readonly DraftEvaluator[]
    disabled?: boolean
    onPick: (evaluator: DraftEvaluator) => void
    onRemove: (revisionId: string) => void
    onClear: () => void
}) => {
    const metaMap = useAtomValue(evaluatorWorkflowMetaMapAtom)
    const selectedIds = useMemo(() => new Set(selected.map((item) => item.revisionId)), [selected])
    const selectedByEvaluator = useMemo(() => {
        const map = new Map<string, {id: string; label: string}[]>()
        for (const item of [...selected].sort((a, b) => b.version - a.version)) {
            const list = map.get(item.evaluatorId) ?? []
            list.push({id: item.revisionId, label: `v${item.version}`})
            map.set(item.evaluatorId, list)
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

    return (
        <div className="w-full min-w-0">
            <EntityPicker<WorkflowRevisionSelectionResult>
                variant="popover-cascader"
                adapter={adapter}
                onSelect={(result) => onPick(toDraftEvaluator(result))}
                instanceId={instanceId}
                className="!w-full !justify-start"
                placeholder="Add evaluator"
                icon={<PlusIcon size={14} />}
                showDropdownIcon={false}
                panelMinWidth={280}
                disabled={disabled}
                openChildOnHover
                multiSelect
                selectedChildIds={selectedIds}
                selectionSummary
                showParentCheckboxes
                selectedChildrenByParent={selectedByEvaluator}
                totalChildrenByParent={totalByEvaluator}
                onDeselectChild={onRemove}
                showParentDescription
                showChildSelectAll
                onClearAll={onClear}
                size="middle"
            />
        </div>
    )
}
