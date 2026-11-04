import {memo, useMemo, type ReactNode} from "react"

import {executionItemController} from "@agenta/playground"
import {RunButton} from "@agenta/ui/components/presentational"
import {useAtomValue, useSetAtom} from "jotai"

import {useExecutionCell} from "../../hooks/useExecutionCell"
import {openPlaygroundFocusDrawerAtom} from "../../state/focusDrawer"
import {InputsList} from "../inputs"
import {RowActions} from "../runs/RowActions"
import {RowSyncTag} from "../runs/RowSyncTag"
import {RunResult} from "../runs/RunResult"

import {LEAD_COLUMN, REVISION_COLUMN} from "./columns"
import {OutputLabel} from "./CompareRowsHeader"

type TemplateFormat = "mustache" | "curly" | "fstring" | "jinja2"

const OutputCell = ({
    rowId,
    revisionId,
    renderTraceFooter,
}: {
    rowId: string
    revisionId: string
    renderTraceFooter?: (traceId: string) => ReactNode
}) => {
    const cell = useExecutionCell({entityId: revisionId, stepId: rowId})
    return (
        <div
            data-testid={`compare-output-${rowId}-${revisionId}`}
            className={`${REVISION_COLUMN} border-b p-3`}
        >
            <OutputLabel revisionId={revisionId} />
            <RunResult
                isRunning={cell.isRunning}
                result={cell.displayResult as React.ComponentProps<typeof RunResult>["result"]}
                traceId={cell.traceId}
                repeats={cell.repetitionProps}
                renderTraceFooter={renderTraceFooter}
            />
        </div>
    )
}

export interface CompletionCompareRowProps {
    rowId: string
    /** 0-based position, shown as "test case {n}". */
    index: number
    revisionIds: string[]
    canRemove: boolean
    templateFormat?: TemplateFormat
    renderTraceFooter?: (traceId: string) => ReactNode
}

/**
 * One test case across every revision: the inputs and the row's controls in the input column,
 * then each revision's output in its own column. Run runs the row on every revision.
 */
export const CompletionCompareRow = memo(
    ({
        rowId,
        index,
        revisionIds,
        canRemove,
        templateFormat,
        renderTraceFooter,
    }: CompletionCompareRowProps) => {
        const busy = useAtomValue(
            useMemo(() => executionItemController.selectors.isBusyForRow({rowId}), [rowId]),
        )
        const runRow = useSetAtom(executionItemController.actions.runRow)
        const cancelRow = useSetAtom(executionItemController.actions.cancelRow)
        const deleteRow = useSetAtom(executionItemController.actions.deleteRow)
        const duplicateRow = useSetAtom(executionItemController.actions.duplicateRow)
        const openDetails = useSetAtom(openPlaygroundFocusDrawerAtom)
        // The focus drawer shows one revision's output: the first column's.
        const showDetails = () => openDetails({rowId, entityId: revisionIds[0]})

        return (
            <div
                data-testid={`compare-row-${rowId}`}
                className="flex flex-col md:min-w-fit md:flex-row"
            >
                <div className={`${LEAD_COLUMN} flex flex-col gap-3 border-b p-3`}>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={showDetails}
                            className="whitespace-nowrap rounded-md border-0 bg-muted px-2 py-0.5 text-xs text-foreground"
                        >
                            {`test case ${index + 1}`}
                        </button>
                        <RowSyncTag rowId={rowId} />
                        <div className="ml-auto flex items-center gap-2">
                            <RowActions
                                canRemove={canRemove}
                                onOpenDetails={showDetails}
                                onRemove={() => deleteRow(rowId)}
                                onDuplicate={() => duplicateRow(rowId)}
                            />
                            {busy ? (
                                <RunButton mode="cancel" onClick={() => cancelRow({rowId})} />
                            ) : (
                                <RunButton onClick={() => runRow({rowId})} />
                            )}
                        </div>
                    </div>
                    <InputsList rowId={rowId} templateFormat={templateFormat} />
                </div>
                {revisionIds.map((revisionId) => (
                    <OutputCell
                        key={revisionId}
                        rowId={rowId}
                        revisionId={revisionId}
                        renderTraceFooter={renderTraceFooter}
                    />
                ))}
            </div>
        )
    },
)
CompletionCompareRow.displayName = "CompletionCompareRow"
