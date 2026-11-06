import {useMemo} from "react"

import {activateEvaluatorEnrichmentAtom, workflowMolecule} from "@agenta/entities/workflow"
import {
    EntityPicker,
    useEnrichedEvaluatorOnlyAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import type {PlaygroundNode} from "@agenta/playground/state"
import {Badge, cn} from "@agenta/ui/ui"
import {Gavel, X} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

/** One evaluator after the app: its name and version, and a button that takes it off. */
const EvaluatorChip = ({node, onRemove}: {node: PlaygroundNode; onRemove: () => void}) => {
    const name = useAtomValue(workflowMolecule.selectors.artifactName(node.entityId))
    const data = useAtomValue(workflowMolecule.selectors.data(node.entityId))
    const label = `${name?.trim() || data?.slug?.trim() || "Evaluator"}${
        data?.version != null ? ` v${data.version}` : ""
    }`
    return (
        <Badge variant="success" className="max-w-40 shrink-0 gap-1 pr-0.5">
            <span className="truncate">{label}</span>
            <button
                type="button"
                aria-label={`Disconnect ${label}`}
                onClick={onRemove}
                className="flex shrink-0 items-center rounded-sm border-0 bg-transparent p-0.5 text-inherit opacity-60 hover:opacity-100"
            >
                <X aria-hidden size={10} />
            </button>
        </Badge>
    )
}

/**
 * Evaluators that score each output of the app in the playground: a chip per connected
 * evaluator, and the automatic evaluators (human ones cannot score a run) by type, with their
 * revisions, to add one. An added evaluator runs after the app on every run. With
 * `onCreateNew` the list ends with "Create new evaluator".
 *
 * The evaluator data loads on the first open, not with the playground.
 */
export const EvaluatorPicker = ({onCreateNew}: {onCreateNew?: () => void}) => {
    const activate = useSetAtom(activateEvaluatorEnrichmentAtom)
    const nodes = useAtomValue(playgroundController.selectors.nodes())
    const connect = useSetAtom(playgroundController.actions.connectDownstreamNode)
    const disconnect = useSetAtom(playgroundController.actions.disconnectSingleDownstreamNode)
    const root = nodes.find((node) => node.depth === 0)
    const evaluators = nodes.filter((node) => node.depth > 0)
    const connectedIds = useMemo(
        () => new Set(evaluators.map((node) => node.entityId)),
        [evaluators],
    )
    const adapter = useEnrichedEvaluatorOnlyAdapter(undefined, {showWorkflowMeta: true, lazy: true})

    const add = (selection: WorkflowRevisionSelectionResult) => {
        if (!root) return
        connect({
            sourceNodeId: root.id,
            entity: {type: "workflow", id: selection.id, label: selection.label},
        })
    }

    return (
        // The chips shrink and scroll; the button keeps its width, so a narrow bar cannot cover it.
        <div
            className={cn(
                "grid items-center gap-1",
                evaluators.length > 0 ? "grid-cols-[minmax(0,auto)_auto]" : "grid-cols-[auto]",
            )}
        >
            {evaluators.length > 0 ? (
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                    {evaluators.map((node) => (
                        <EvaluatorChip
                            key={node.id}
                            node={node}
                            onRemove={() => disconnect(node.id)}
                        />
                    ))}
                </div>
            ) : null}
            {/* The first press opens the data gate, before the picker opens on the same press. */}
            <div onPointerDownCapture={activate} onFocusCapture={activate}>
                <EntityPicker<WorkflowRevisionSelectionResult>
                    variant="popover-cascader"
                    adapter={adapter}
                    instanceId="playground-evaluator-picker"
                    onSelect={add}
                    placeholder="Evaluator"
                    icon={<Gavel aria-hidden size={14} />}
                    showDropdownIcon={false}
                    placement="bottomRight"
                    panelMinWidth={280}
                    disabled={!root}
                    disabledChildIds={connectedIds}
                    disabledChildTooltip="Already connected"
                    openChildOnHover
                    showParentDescription
                    onCreateNew={onCreateNew}
                    createNewLabel="Create new evaluator"
                    size="small"
                />
            </div>
        </div>
    )
}
