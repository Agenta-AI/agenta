import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    ArrowsOutLineHorizontalIcon,
    CaretDownIcon,
    CaretLineDownIcon,
    CaretLineUpIcon,
    CaretRightIcon,
    CopyIcon,
    DatabaseIcon,
    MinusCircleIcon,
} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import VariableControlAdapter from "@/oss/components/Playground/adapters/VariableControlAdapter"
import RunButton from "@/oss/components/Playground/assets/RunButton"
import TypingIndicator from "@/oss/components/Playground/assets/TypingIndicator"
import TestsetDrawerButton from "@/oss/components/Playground/Components/Drawers/TestsetDrawer"
import {allGenerationsCollapsedAtom} from "@/oss/components/Playground/Components/PlaygroundGenerations/assets/GenerationHeader/store"
import {useRepetitionResult} from "@/oss/components/Playground/hooks/useRepetitionResult"
import {generationInputRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"
import {deleteGenerationInputRowMutationAtom} from "@/oss/components/Playground/state/atoms/mutations/input/deleteInputRow"
import {duplicateGenerationInputRowMutationAtom} from "@/oss/components/Playground/state/atoms/mutations/input/duplicateInputRow"
import {inputRowIdsAtom} from "@/oss/state/generation/entities"
import {variableIdsUnifiedAtomFamily} from "@/oss/state/newPlayground/generation/selectors"
import {openPlaygroundFocusDrawerAtom} from "@/oss/state/playgroundFocusDrawerAtom"

import {ClickRunPlaceholder} from "../ResultPlaceholder"

import ErrorPanel from "./ErrorPanel"
import GenerationResponsePanel from "./GenerationResponsePanel"

interface Props {
    rowId: string
    variantId: string
    isChat: boolean
    isBusy: boolean
    isRunning: boolean
    inputOnly?: boolean
    result: any
    resultHash: string | null
    runRow: () => void
    cancelRow: () => void
    containerClassName?: string
}

const SingleView = ({
    rowId,
    variantId,
    isChat,
    isBusy,
    isRunning,
    inputOnly,
    result,
    resultHash,
    runRow,
    cancelRow,
    containerClassName,
}: Props) => {
    const variableIds = useAtom(
        useMemo(
            () => variableIdsUnifiedAtomFamily({rowId, revisionId: variantId}),
            [rowId, variantId],
        ),
    )[0] as string[]

    const openFocusDrawer = useSetAtom(openPlaygroundFocusDrawerAtom)
    const {currentResult, repetitionProps} = useRepetitionResult({
        rowId,
        variantId,
        result,
    })

    const inputRowIds = useAtomValue(generationInputRowIdsAtom) as string[]
    const allInputRowIds = useAtomValue(inputRowIdsAtom) as string[]
    const testCaseNumber = useMemo(() => {
        const index = inputRowIds.indexOf(rowId)
        return index >= 0 ? index + 1 : null
    }, [inputRowIds, rowId])

    // Delete and duplicate handlers
    const deleteInputRow = useSetAtom(deleteGenerationInputRowMutationAtom)
    const duplicateInputRow = useSetAtom(duplicateGenerationInputRowMutationAtom)
    const inputRowsLength = allInputRowIds?.length || 0

    // Check if there are results for the add to testset button
    const hasResults = useMemo(() => {
        return Boolean(resultHash && result)
    }, [resultHash, result])

    // Global collapse state from header (for "collapse all" / "expand all")
    const [isAllGenerationsCollapsed] = useAtom(allGenerationsCollapsedAtom)

    // Local collapse state for this specific test case
    const [isCollapsed, setIsCollapsed] = useState(false)

    // Track previous global state to detect changes from header
    const prevGlobalCollapsed = useRef(isAllGenerationsCollapsed)

    // Sync local state when global "collapse all" state changes from header
    useEffect(() => {
        if (prevGlobalCollapsed.current !== isAllGenerationsCollapsed) {
            setIsCollapsed(isAllGenerationsCollapsed)
            prevGlobalCollapsed.current = isAllGenerationsCollapsed
        }
    }, [isAllGenerationsCollapsed])

    // Collapse state for individual input/output components
    const [collapsedInputs, setCollapsedInputs] = useState<Record<string, boolean>>({})
    const [collapsedOutput] = useState(false)

    const toggleInputCollapse = useCallback((id: string) => {
        setCollapsedInputs((prev) => ({...prev, [id]: !prev[id]}))
    }, [])

    if (inputOnly && variableIds.length === 0) {
        return null
    }

    if (isCollapsed && !inputOnly) {
        return (
            <div className={clsx(["flex flex-col", "p-4", "group/item", containerClassName])}>
                <div className="w-full flex items-center gap-2">
                    <EnhancedButton
                        icon={<CaretRightIcon size={14} />}
                        type="text"
                        onClick={() => setIsCollapsed(false)}
                        tooltipProps={{title: "Expand"}}
                        size="small"
                    />
                    {testCaseNumber && (
                        <span className="text-sm text-gray-500">Test case {testCaseNumber}</span>
                    )}
                    <div className="flex-1" />
                    <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                        <EnhancedButton
                            icon={<ArrowsOutLineHorizontalIcon size={12} />}
                            size="small"
                            type="text"
                            onClick={() => openFocusDrawer({rowId, variantId})}
                            tooltipProps={{title: "Expand results"}}
                            disabled={!hasResults}
                        />
                        <EnhancedButton
                            icon={<MinusCircleIcon size={14} />}
                            type="text"
                            onClick={() => deleteInputRow(rowId)}
                            size="small"
                            disabled={inputRowsLength === 1}
                            tooltipProps={{title: "Remove"}}
                        />
                        <EnhancedButton
                            icon={<CopyIcon size={14} />}
                            type="text"
                            onClick={() => duplicateInputRow(rowId)}
                            size="small"
                            tooltipProps={{title: "Duplicate"}}
                        />
                        <TestsetDrawerButton
                            resultHashes={resultHash ? [resultHash] : []}
                            icon={false}
                        >
                            <EnhancedButton
                                icon={<DatabaseIcon size={14} />}
                                type="text"
                                size="small"
                                disabled={!hasResults}
                                tooltipProps={{title: "Add to testset"}}
                            />
                        </TestsetDrawerButton>
                    </div>
                    {!isBusy ? (
                        <RunButton onClick={runRow} disabled={!!isRunning} className="flex" />
                    ) : (
                        <RunButton isCancel onClick={cancelRow} className="flex" />
                    )}
                </div>
            </div>
        )
    }

    return (
        <div
            className={clsx([
                "flex flex-col gap-1",
                "p-4",
                "group/item",
                {"gap-4": variableIds.length > 0},
                containerClassName,
            ])}
        >
            {!inputOnly && (
                <div className="w-full flex items-center gap-2 mb-0 group/header">
                    <EnhancedButton
                        icon={<CaretDownIcon size={14} />}
                        type="text"
                        onClick={() => setIsCollapsed(true)}
                        tooltipProps={{title: "Collapse"}}
                        size="small"
                    />
                    {testCaseNumber && (
                        <span className="text-sm text-gray-500">Test case {testCaseNumber}</span>
                    )}
                    <div className="flex-1" />
                    <div className="flex items-center gap-1 opacity-0 group-hover/header:opacity-100 transition-opacity">
                        <EnhancedButton
                            icon={<ArrowsOutLineHorizontalIcon size={12} />}
                            size="small"
                            type="text"
                            onClick={() => openFocusDrawer({rowId, variantId})}
                            tooltipProps={{title: "Expand results"}}
                            disabled={!hasResults}
                        />
                        <EnhancedButton
                            icon={<MinusCircleIcon size={14} />}
                            type="text"
                            onClick={() => deleteInputRow(rowId)}
                            size="small"
                            disabled={inputRowsLength === 1}
                            tooltipProps={{title: "Remove"}}
                        />
                        <EnhancedButton
                            icon={<CopyIcon size={14} />}
                            type="text"
                            onClick={() => duplicateInputRow(rowId)}
                            size="small"
                            tooltipProps={{title: "Duplicate"}}
                        />
                        <TestsetDrawerButton
                            resultHashes={resultHash ? [resultHash] : []}
                            icon={false}
                        >
                            <EnhancedButton
                                icon={<DatabaseIcon size={14} />}
                                type="text"
                                size="small"
                                disabled={!hasResults}
                                tooltipProps={{title: "Add to testset"}}
                            />
                        </TestsetDrawerButton>
                    </div>
                    {!isBusy ? (
                        <RunButton
                            onClick={runRow}
                            disabled={!!isRunning}
                            className="flex"
                            data-tour="run-button"
                        />
                    ) : (
                        <RunButton isCancel onClick={cancelRow} className="flex" />
                    )}
                </div>
            )}

            <div
                className={clsx("flex flex-col gap-4 w-full", {
                    "flex flex-col gap-4 w-full": isChat,
                })}
            >
                {variableIds.length > 0 && (
                    <div className="flex flex-col gap-2 w-full">
                        {variableIds.map((id) => {
                            const isInputCollapsed = collapsedInputs[id] || false
                            return (
                                <div
                                    key={id}
                                    className={clsx([
                                        "relative group/item px-0 py-2 w-full",
                                        "hover:[&_.collapse-icon]:opacity-100",
                                    ])}
                                >
                                    <div className="relative w-full">
                                        <div
                                            className={clsx(
                                                "relative w-full transition-all duration-300 ease-linear",
                                            )}
                                        >
                                            <VariableControlAdapter
                                                variantId={variantId}
                                                propertyId={id}
                                                key={id}
                                                rowId={rowId}
                                                className={clsx([
                                                    "*:!border-none w-full",
                                                    {
                                                        "max-h-[120px] overflow-hidden":
                                                            isInputCollapsed,
                                                    },
                                                ])}
                                                editorProps={{enableTokens: false}}
                                            />
                                        </div>
                                        <EnhancedButton
                                            className={clsx([
                                                "absolute top-2 right-2 z-[2] opacity-0 transition-opacity collapse-icon",
                                                "group-hover/item:opacity-100",
                                            ])}
                                            onClick={() => toggleInputCollapse(id)}
                                            size="small"
                                            type="text"
                                            icon={
                                                isInputCollapsed ? (
                                                    <CaretLineDownIcon size={14} />
                                                ) : (
                                                    <CaretLineUpIcon size={14} />
                                                )
                                            }
                                            tooltipProps={{
                                                title: isInputCollapsed ? "Expand" : "Collapse",
                                            }}
                                        />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
            {!inputOnly ? (
                <div className={clsx(["w-full flex flex-col gap-4 pb-2 relative group/output"])}>
                    <div
                        className={clsx(
                            "relative w-full transition-all duration-300 ease-linear overflow-hidden",
                            {
                                "max-h-[120px]": collapsedOutput,
                                "h-fit": !collapsedOutput,
                            },
                        )}
                    >
                        {isBusy ? (
                            <TypingIndicator />
                        ) : !currentResult ? (
                            <ClickRunPlaceholder />
                        ) : (
                            <div className="flex flex-col gap-2">
                                {currentResult.error ? (
                                    <ErrorPanel result={currentResult} />
                                ) : currentResult.response ? (
                                    <GenerationResponsePanel
                                        key={repetitionProps?.current || 0}
                                        result={currentResult}
                                        repetitionProps={repetitionProps}
                                        rowId={rowId}
                                        variantId={variantId}
                                    />
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default SingleView
