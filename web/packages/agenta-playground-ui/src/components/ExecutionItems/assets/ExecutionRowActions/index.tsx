import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {Button} from "@agenta/primitive-ui/components/button"
import {Copy, MinusCircle} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {usePlaygroundLayout} from "../../../../hooks/usePlaygroundLayout"

export interface ExecutionRowActionsProps {
    className?: string
    rowId: string
    variableId?: string
    /** Render slot for the variable menu in single view — receives executionId to self-serve data */
    renderMenu?: (props: {executionId: string}) => React.ReactNode
}

const ExecutionRowActions: React.FC<ExecutionRowActionsProps> = ({
    rowId,
    className,
    variableId,
    renderMenu,
}) => {
    const variableRowIds = useAtomValue(executionItemController.selectors.executionRowIds)
    const variableValue = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.rowVariableValue({
                    rowId,
                    variableId: variableId ?? "",
                }),
            [rowId, variableId],
        ),
    )
    const {isComparisonView} = usePlaygroundLayout()

    const deleteRow = useSetAtom(executionItemController.actions.deleteRow)

    const variableRowsLength = variableRowIds?.length || 0
    const viewType = isComparisonView ? "comparison" : "single"

    return (
        <div className={clsx("flex items-center gap-1 z-[2]", className)}>
            <Button
                onClick={() => deleteRow(rowId)}
                disabled={variableRowsLength === 1}
                variant="ghost"
                size="icon-sm"
            >
                {<MinusCircle size={14} />}
            </Button>
            {viewType === "single" && renderMenu?.({executionId: rowId})}
            {viewType === "comparison" && (
                <Button
                    onClick={() => {
                        navigator.clipboard.writeText(variableValue)
                    }}
                    variant="ghost"
                    size="icon-sm"
                >
                    {<Copy size={14} />}
                </Button>
            )}
        </div>
    )
}

export default ExecutionRowActions
