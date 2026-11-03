import {executionItemController} from "@agenta/playground"
import {CollapsibleGroupHeader, RunButton} from "@agenta/ui/components/presentational"
import {useRunAllShortcut} from "@agenta/ui/hooks"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowsInLineVertical, ArrowsOutLineVertical} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

export interface RunsPanelHeaderProps {
    entityId: string
}

/**
 * The bar above the rows: "Generations" folds every row, Clear empties the outputs, Run all runs
 * every row and turns into Cancel while they run. Ctrl or ⌘ with Enter runs all.
 */
export const RunsPanelHeader = ({entityId}: RunsPanelHeaderProps) => {
    const {isRunning} = useAtomValue(executionItemController.selectors.headerData(entityId)) as {
        isRunning?: boolean
    }
    const running = Boolean(isRunning)
    const runAll = useSetAtom(executionItemController.actions.runAll)
    const cancelAll = useSetAtom(executionItemController.actions.cancelAll)
    const clearAll = useSetAtom(executionItemController.actions.clearAll)
    const [allCollapsed, setAllCollapsed] = useAtom(
        executionItemController.selectors.allRowsCollapsed,
    )

    const run = () => runAll({entityId})
    useRunAllShortcut({isRunning: running, canRun: true, onRun: run})

    return (
        <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between gap-4 border-0 border-b border-solid border-border bg-background px-4">
            <CollapsibleGroupHeader
                label="Generations"
                isCollapsed={allCollapsed}
                onClick={() => setAllCollapsed(!allCollapsed)}
                iconSize={16}
                renderIcon={(collapsed, size) =>
                    collapsed ? (
                        <ArrowsOutLineVertical size={size} />
                    ) : (
                        <ArrowsInLineVertical size={size} />
                    )
                }
                className="items-center text-base font-semibold text-nowrap"
            />
            <div className="flex items-center gap-2">
                <SimpleTooltip title="Clear all" side="bottom">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={running}
                        onClick={() => clearAll()}
                    >
                        Clear
                    </Button>
                </SimpleTooltip>
                {running ? (
                    <RunButton mode="cancel" onClick={() => cancelAll()} />
                ) : (
                    <SimpleTooltip
                        title="Run the prompt on all test cases. (Ctrl+Enter / ⌘+Enter)"
                        side="bottom"
                    >
                        <RunButton mode="runAll" onClick={run} />
                    </SimpleTooltip>
                )}
            </div>
        </div>
    )
}
