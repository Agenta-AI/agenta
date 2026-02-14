import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {EnhancedButton, RunButton} from "@agenta/ui/components/presentational"
import {CopySimpleIcon, MinusCircleIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {VariableControlAdapter} from "@agenta/playground-ui/adapters"

interface Props {
    rowId: string
    entityId?: string
    isChat: boolean
    viewType: "single" | "comparison"
    view?: string
    disabled?: boolean
    inputOnly?: boolean
    resultHash: string | null
    runRow: () => void
    cancelRow: () => void
    isBusy: boolean
    appType?: string
}

const CopyVariableButton = ({rowId, variableKey}: {rowId: string; variableKey: string}) => {
    const value = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.testcaseCellValue({
                    testcaseId: rowId,
                    column: variableKey,
                }),
            [rowId, variableKey],
        ),
    ) as string

    return (
        <EnhancedButton
            size="small"
            type="text"
            icon={<CopySimpleIcon size={14} />}
            onClick={() => navigator.clipboard.writeText(value)}
            tooltipProps={{title: "Copy"}}
        />
    )
}

const ComparisonLayout = ({
    rowId,
    entityId,
    isChat,
    viewType,
    view,
    disabled,
    inputOnly,
    resultHash,
    runRow,
    cancelRow,
    isBusy,
    appType,
}: Props) => {
    const variableIds = useAtomValue(executionItemController.selectors.variableKeys) as string[]
    const deleteRow = useSetAtom(executionItemController.actions.deleteRow)
    const executionRowIds = useAtomValue(
        executionItemController.selectors.executionRowIds,
    ) as string[]
    const rowCount = executionRowIds?.length || 0

    if (inputOnly && variableIds.length === 0) {
        return null
    }

    return (
        <>
            <div
                className={clsx([
                    "flex flex-col gap-4",
                    {"max-w-[100%]": viewType === "comparison"},
                ])}
            >
                <div className="flex gap-1 items-start">
                    <div className="flex flex-col grow">
                        {variableIds.map((variableId) => (
                            <div
                                key={variableId}
                                className={clsx([
                                    "relative group/item",
                                    {
                                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]":
                                            isChat && viewType === "comparison",
                                    },
                                ])}
                            >
                                <VariableControlAdapter
                                    entityId={entityId as string}
                                    variableKey={variableId}
                                    view={view}
                                    rowId={rowId}
                                    appType={appType}
                                    className={clsx([
                                        "*:!border-none",
                                        {
                                            "rounded-none [&_article]:px-3 [&_article]:py-1 px-3":
                                                viewType === "comparison",
                                        },
                                    ])}
                                    disabled={disabled}
                                    placeholder="Enter value"
                                    editorProps={{enableTokens: false}}
                                    headerActions={
                                        !inputOnly ? (
                                            <>
                                                <CopyVariableButton
                                                    rowId={rowId}
                                                    variableKey={variableId}
                                                />
                                                <EnhancedButton
                                                    size="small"
                                                    type="text"
                                                    icon={<MinusCircleIcon size={14} />}
                                                    onClick={() => deleteRow(rowId)}
                                                    disabled={rowCount <= 1}
                                                    tooltipProps={{title: "Remove"}}
                                                />
                                            </>
                                        ) : undefined
                                    }
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {!inputOnly ? (
                <div className={clsx("h-[48px] flex items-center px-4")}>
                    {isBusy ? (
                        <RunButton isCancel onClick={cancelRow} className="flex" />
                    ) : (
                        <RunButton onClick={runRow} className="flex" />
                    )}
                </div>
            ) : null}
        </>
    )
}

export default ComparisonLayout
