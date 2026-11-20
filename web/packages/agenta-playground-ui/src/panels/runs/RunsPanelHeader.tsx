import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import runsCatalog from "@agenta/i18n/catalogs/playground.runs"
import {executionController, executionItemController} from "@agenta/playground"
import {CollapsibleGroupHeader, RunButton} from "@agenta/ui/components/presentational"
import {useRunAllShortcut} from "@agenta/ui/hooks"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowsInLineVertical, ArrowsOutLineVertical} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

export interface RunsPanelHeaderProps {
    /** The revision whose rows run. Without one, the bar runs every revision on screen (compare). */
    entityId?: string
    /** The title that folds the panel. */
    label?: string
    /** The test set menu, left of Clear. */
    testsetMenu?: ReactNode
}

/**
 * The bar above the rows: the label ("Generations" by default) folds every row, Clear empties the
 * outputs, Run all runs every row and turns into Cancel while they run. Ctrl or ⌘ with Enter runs
 * all. In the compare view (no `entityId`) Run all runs every revision, and the label does not fold:
 * the compare rows have no fold.
 */
export const RunsPanelHeader = ({entityId, label, testsetMenu}: RunsPanelHeaderProps) => {
    const t = useT(runsCatalog)
    const shownLabel = label ?? t("playground.runs.generations")
    const {isRunning} = useAtomValue(
        entityId
            ? executionItemController.selectors.headerData(entityId)
            : executionItemController.selectors.aggregatedHeaderData,
    ) as {isRunning?: boolean}
    const running = Boolean(isRunning)
    const isChat = useAtomValue(executionController.selectors.isChatMode)
    const canRunChatCompare = useAtomValue(executionController.selectors.canRunAllChatComparison)
    // A chat compare runs the last turn, so it needs a user message there first.
    const canRun = Boolean(entityId) || !isChat || canRunChatCompare
    const runAll = useSetAtom(executionItemController.actions.runAll)
    const cancelAll = useSetAtom(executionItemController.actions.cancelAll)
    const clearAll = useSetAtom(executionItemController.actions.clearAll)
    const [allCollapsed, setAllCollapsed] = useAtom(
        executionItemController.selectors.allRowsCollapsed,
    )

    const run = () => runAll(entityId ? {entityId} : undefined)
    useRunAllShortcut({isRunning: running, canRun, onRun: run})

    return (
        // A narrow pane (a phone) wraps the controls under the label instead of cutting them off.
        <div className="sticky top-0 z-10 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-0 border-b border-solid border-border bg-background px-4 py-2">
            {entityId ? (
                <CollapsibleGroupHeader
                    label={shownLabel}
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
                    // On a phone the pane switch above already says "Generations": the label hides
                    // there and the fold icon stays.
                    className="items-center text-base font-semibold text-nowrap max-sm:[&>span:last-child]:sr-only"
                />
            ) : (
                <span className="text-base font-semibold text-nowrap">{shownLabel}</span>
            )}
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                {testsetMenu}
                <SimpleTooltip title={t("playground.runs.clearAll")} side="bottom">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={running}
                        onClick={() => clearAll()}
                    >
                        {t("playground.runs.clear")}
                    </Button>
                </SimpleTooltip>
                {running ? (
                    <RunButton mode="cancel" onClick={() => cancelAll()} />
                ) : (
                    <SimpleTooltip title={t("playground.runs.runAll")} side="bottom">
                        <RunButton
                            mode="runAll"
                            variant="default"
                            onClick={run}
                            disabled={!canRun}
                        />
                    </SimpleTooltip>
                )}
            </div>
        </div>
    )
}
