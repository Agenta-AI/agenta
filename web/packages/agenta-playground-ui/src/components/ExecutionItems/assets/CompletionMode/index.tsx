import React, {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {AddButton} from "@agenta/ui/components/presentational"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {usePlaygroundLayout} from "../../../../hooks/usePlaygroundLayout"
import ExecutionRow from "../ExecutionRow"

export interface CompletionModeProps {
    entityId?: string
    className?: string
    rowClassName?: string
    withControls?: boolean
    rowId?: string
    appType?: string
    /** Render slot for testset drawer button (passed through to ExecutionRow) */
    renderTestsetButton?: (props: {
        results: unknown[]
        icon: boolean
        children: React.ReactNode
    }) => React.ReactNode
}

/** @deprecated Alias kept for backward compatibility */
export type GenerationCompletionProps = CompletionModeProps

const CompletionMode = ({
    className,
    entityId,
    rowClassName,
    rowId,
    withControls,
    appType,
    renderTestsetButton,
}: CompletionModeProps) => {
    const {isComparisonView} = usePlaygroundLayout()
    const viewType = isComparisonView ? "comparison" : "single"

    const executionRowIds = useAtomValue(
        useMemo(
            () => executionItemController.selectors.rowIdsForEntity(entityId ?? ""),
            [entityId],
        ),
    )

    // executionItemController.actions.addRow handles data management (testset row creation + local testset init)
    const handleAddNewRow = useSetAtom(executionItemController.actions.addRow)

    return (
        <div className={clsx(["flex flex-col"], className)}>
            {viewType === "comparison" ? (
                <ExecutionRow
                    entityId={entityId}
                    rowId={rowId || executionRowIds[0]}
                    className={rowClassName}
                    appType={appType}
                    renderTestsetButton={renderTestsetButton}
                />
            ) : (
                executionRowIds.map((rowIdItem) => (
                    <ExecutionRow
                        key={rowIdItem}
                        entityId={entityId}
                        rowId={rowIdItem}
                        className={rowClassName}
                        appType={appType}
                        renderTestsetButton={renderTestsetButton}
                    />
                ))
            )}

            {withControls ? (
                <div
                    className={clsx([
                        "flex items-center gap-2 px-4 pt-3",
                        {"pb-4": viewType !== "comparison", "pb-3": viewType === "comparison"},
                    ])}
                >
                    <AddButton size="small" label="Test case" onClick={() => handleAddNewRow()} />
                </div>
            ) : null}
        </div>
    )
}

export default CompletionMode
