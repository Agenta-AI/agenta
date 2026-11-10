import {workflowMolecule} from "@agenta/entities/workflow"
import {executionItemController, playgroundController} from "@agenta/playground"
import type {PlaygroundNode} from "@agenta/playground/state"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown, Play} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

const StepItem = ({
    node,
    disabled,
    onSelect,
}: {
    node: PlaygroundNode
    disabled: boolean
    onSelect: () => void
}) => {
    const name = useAtomValue(workflowMolecule.selectors.artifactName(node.entityId))
    return (
        <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
            <Play aria-hidden size={14} />
            {`Run ${name?.trim() || node.label || "step"}`}
        </DropdownMenuItem>
    )
}

/**
 * The caret beside a row's Run when evaluators run after the app, as in the old playground: run
 * one step of the chain. An evaluator step needs the app's output first, so it is off until the
 * app has run on this row. Nothing shows without an evaluator.
 */
export const RowRunSteps = ({
    rowId,
    entityId,
    appHasOutput,
    disabled,
}: {
    rowId: string
    /** The app revision of the row. */
    entityId: string
    appHasOutput: boolean
    disabled?: boolean
}) => {
    const nodes = [...useAtomValue(playgroundController.selectors.nodes())].sort(
        (a, b) => a.depth - b.depth,
    )
    const runStep = useSetAtom(executionItemController.actions.runRowStep)
    if (!nodes.some((node) => node.depth > 0)) return null

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Run one step"
                    disabled={disabled}
                    className="-ml-1.5"
                >
                    <CaretDown aria-hidden size={12} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {nodes.map((node) => (
                    <StepItem
                        key={node.id}
                        node={node}
                        disabled={node.depth > 0 && !appHasOutput}
                        onSelect={() => runStep({rowId, entityId, targetNodeId: node.entityId})}
                    />
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
