import {useMemo, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {
    createWorkflowRevisionAdapter,
    TreeSelectPopupContent,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import type {PlaygroundNode} from "@agenta/playground/state"
import {Badge, Button, cn, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
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
        <Badge variant="purple" className="max-w-40 shrink-0 gap-1 pr-0.5">
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
 * evaluator, and a list of evaluators and their revisions to add one. An added evaluator runs
 * after the app on every run.
 */
export const EvaluatorPicker = () => {
    const [open, setOpen] = useState(false)
    const nodes = useAtomValue(playgroundController.selectors.nodes())
    const connect = useSetAtom(playgroundController.actions.connectDownstreamNode)
    const disconnect = useSetAtom(playgroundController.actions.disconnectSingleDownstreamNode)
    const root = nodes.find((node) => node.depth === 0)
    const evaluators = nodes.filter((node) => node.depth > 0)
    const connectedIds = useMemo(
        () => new Set(evaluators.map((node) => node.entityId)),
        [evaluators],
    )
    const adapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: true, is_feedback: false},
                parentLabel: "Evaluator",
            }),
        [],
    )

    const add = (selection: WorkflowRevisionSelectionResult) => {
        setOpen(false)
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
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1" disabled={!root}>
                        <Gavel aria-hidden size={14} />
                        <span className="max-sm:sr-only">Evaluator</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[296px] p-0">
                    {open ? (
                        <TreeSelectPopupContent<WorkflowRevisionSelectionResult>
                            adapter={adapter}
                            defaultExpandAll={false}
                            disabledChildIds={connectedIds}
                            onSelect={add}
                            width={280}
                            maxHeight={400}
                        />
                    ) : null}
                </PopoverContent>
            </Popover>
        </div>
    )
}
