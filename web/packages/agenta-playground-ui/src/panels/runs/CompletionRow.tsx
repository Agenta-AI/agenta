import {memo, useEffect, useState, type ReactNode} from "react"

import {executionItemController} from "@agenta/playground"
import {HeightCollapse} from "@agenta/ui/components"
import {RunButton} from "@agenta/ui/components/presentational"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {useExecutionRow} from "../../hooks/useExecutionRow"
import {InputsList} from "../inputs"

import {RowActions} from "./RowActions"
import {RunResult} from "./RunResult"

export interface CompletionRowProps {
    entityId: string
    rowId: string
    /** 0-based position, shown as "testcase {n}". */
    index: number
    canRemove: boolean
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
    renderTraceFooter?: (traceId: string) => ReactNode
}

/**
 * One test case: its label (which folds the row), remove and duplicate, the run control, then the
 * inputs and the result. "Collapse all" in the header folds every row; a click on one row's label
 * then overrides it for that row until the next "collapse all".
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
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        aria-expanded={!collapsed}
                        onClick={() => {
                            setClicked(true)
                            setOwn(!collapsed)
                        }}
                        className="flex min-w-0 items-center gap-1 rounded-md border-0 bg-muted px-2 py-0.5 text-xs text-foreground"
                    >
                        {collapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                        <span className="truncate">{`testcase ${index + 1}`}</span>
                    </button>
                    <div className="flex-1" />
                    <RowActions
                        canRemove={canRemove}
                        onRemove={() => deleteRow(rowId)}
                        onDuplicate={() => duplicateRow(rowId)}
                    />
                    {row.isBusy ? (
                        <RunButton mode="cancel" onClick={row.cancelRow} />
                    ) : (
                        <RunButton onClick={row.runRow} disabled={row.isRunning} />
                    )}
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
                    </div>
                </HeightCollapse>
            </section>
        )
    },
)
CompletionRow.displayName = "CompletionRow"
