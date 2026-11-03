import {memo, useEffect, useState, type ReactNode} from "react"

import {executionItemController} from "@agenta/playground"
import {HeightCollapse} from "@agenta/ui/components"
import {RunButton} from "@agenta/ui/components/presentational"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {useExecutionRow} from "../../hooks/useExecutionRow"
import {openPlaygroundFocusDrawerAtom} from "../../state/focusDrawer"
import {EvaluatorScoreCards} from "../evaluator/EvaluatorScoreCards"
import {InputsList} from "../inputs"

import {RowActions} from "./RowActions"
import {RowSyncTag} from "./RowSyncTag"
import {RunResult} from "./RunResult"

export interface CompletionRowProps {
    entityId: string
    rowId: string
    /** 0-based position, shown as "test case {n}". */
    index: number
    canRemove: boolean
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
    renderTraceFooter?: (traceId: string) => ReactNode
}

/**
 * One test case: the caret that folds the row, its label (which opens the focus drawer), the sync
 * tag, the row actions, the run control, then the inputs, the result, and the score of each
 * evaluator that runs after the app. "Collapse all" in the
 * header folds every row; the caret on one row then overrides it for that row until the next
 * "collapse all".
 */
export const CompletionRow = memo(
    ({
        entityId,
        rowId,
        index,
        canRemove,
        templateFormat,
        renderTraceFooter,
    }: CompletionRowProps) => {
        const row = useExecutionRow({entityId, rowId})
        const deleteRow = useSetAtom(executionItemController.actions.deleteRow)
        const duplicateRow = useSetAtom(executionItemController.actions.duplicateRow)
        const openDetails = useSetAtom(openPlaygroundFocusDrawerAtom)

        const allCollapsed = useAtomValue(executionItemController.selectors.allRowsCollapsed)
        const [own, setOwn] = useState<boolean | null>(null)
        useEffect(() => setOwn(null), [allCollapsed])
        // The fold animates after the first click only, so the first paint does not slide.
        const [clicked, setClicked] = useState(false)
        const collapsed = own ?? allCollapsed

        const result = (row.displayResult ?? null) as React.ComponentProps<
            typeof RunResult
        >["result"]

        return (
            <section
                data-testid={`completion-row-${rowId}`}
                className="flex flex-col gap-3 border-0 border-b border-solid border-border px-4 py-3"
            >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    <div className="flex shrink-0 items-center rounded-md bg-muted text-xs text-foreground">
                        <button
                            type="button"
                            aria-expanded={!collapsed}
                            aria-label={`${collapsed ? "Expand" : "Collapse"} test case ${index + 1}`}
                            onClick={() => {
                                setClicked(true)
                                setOwn(!collapsed)
                            }}
                            className="flex items-center rounded-md border-0 bg-transparent py-0.5 pl-2 pr-1 text-foreground"
                        >
                            {collapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                        </button>
                        <button
                            type="button"
                            onClick={() => openDetails({rowId, entityId})}
                            className="whitespace-nowrap rounded-md border-0 bg-transparent py-0.5 pl-0 pr-2 text-xs text-foreground"
                        >
                            {`test case ${index + 1}`}
                        </button>
                    </div>
                    <RowSyncTag rowId={rowId} />
                    <div className="ml-auto flex items-center gap-2">
                        <RowActions
                            canRemove={canRemove}
                            hasRepeats={!collapsed && Boolean(row.repetitionProps)}
                            onOpenDetails={() => openDetails({rowId, entityId})}
                            onRemove={() => deleteRow(rowId)}
                            onDuplicate={() => duplicateRow(rowId)}
                        />
                        {row.isBusy ? (
                            <RunButton mode="cancel" onClick={row.cancelRow} />
                        ) : (
                            <RunButton onClick={row.runRow} disabled={row.isRunning} />
                        )}
                    </div>
                </div>
                <HeightCollapse open={!collapsed} animate={clicked} contentClassName="w-full">
                    <div className="flex flex-col gap-3">
                        <InputsList rowId={rowId} templateFormat={templateFormat} />
                        <div className="border-0 border-t border-solid border-border pt-3">
                            <RunResult
                                isRunning={row.isBusy}
                                result={result}
                                traceId={row.traceId}
                                repeats={row.repetitionProps}
                                renderTraceFooter={renderTraceFooter}
                            />
                        </div>
                        <EvaluatorScoreCards rowId={rowId} entityId={entityId} />
                    </div>
                </HeightCollapse>
            </section>
        )
    },
)
CompletionRow.displayName = "CompletionRow"
