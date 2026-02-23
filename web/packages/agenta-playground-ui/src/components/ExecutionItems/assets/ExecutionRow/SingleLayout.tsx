import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import {executionItemController, playgroundController} from "@agenta/playground"
import {HeightCollapse} from "@agenta/ui/components"
import {
    CollapsibleGroupHeader,
    EnhancedButton,
    RunButton,
} from "@agenta/ui/components/presentational"
import {
    ArrowsOutLineHorizontalIcon,
    CopyIcon,
    CopySimpleIcon,
    DatabaseIcon,
    MarkdownLogoIcon,
    MinusCircleIcon,
} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {VariableControlAdapter} from "@agenta/playground-ui/adapters"
import {openPlaygroundFocusDrawerAtom} from "@agenta/playground-ui/state"

import {useRepetitionResult} from "../../../../hooks/useRepetitionResult"
import ExecutionResultView from "../../../ExecutionResultView"
import CollapseToggleButton from "../../../shared/CollapseToggleButton"
import { usePlaygroundUIOptional } from "../../../../context/PlaygroundUIContext"

interface Props {
    rowId: string
    entityId: string
    isChat: boolean
    isBusy: boolean
    isRunning: boolean
    inputOnly?: boolean

    result: unknown
    resultHash: string | null
    traceId?: string | null
    runRow: () => void
    cancelRow: () => void
    containerClassName?: string
    appType?: string
    /** Render slot for testset drawer button */
    renderTestsetButton?: (props: {
        results: unknown[]
        icon: boolean
        children: React.ReactNode
    }) => React.ReactNode
}

interface RowHeaderActionsProps {
    rowId: string
    entityId: string
    rowCount: number
    testsetButton?: React.ReactNode
    deleteRow: (rowId: string) => void
    duplicateRow: (rowId: string) => void
    openFocusDrawer: (params: {rowId: string; entityId: string}) => void
    tooltipTitle: string
    className: string
}

const RowHeaderActions = ({
    rowId,
    entityId,
    rowCount,
    testsetButton,
    deleteRow,
    duplicateRow,
    openFocusDrawer,
    tooltipTitle,
    className,
}: RowHeaderActionsProps) => {
    return (
        <div className={className}>
            <EnhancedButton
                icon={<ArrowsOutLineHorizontalIcon size={12} />}
                size="small"
                type="text"
                onClick={() => openFocusDrawer({rowId, entityId})}
                tooltipProps={{title: tooltipTitle}}
            />
            <EnhancedButton
                icon={<MinusCircleIcon size={14} />}
                type="text"
                onClick={() => deleteRow(rowId)}
                size="small"
                disabled={rowCount === 1}
                tooltipProps={{title: "Remove"}}
            />
            <EnhancedButton
                icon={<CopyIcon size={14} />}
                type="text"
                onClick={() => duplicateRow(rowId)}
                size="small"
                tooltipProps={{title: "Duplicate"}}
            />
            {testsetButton}
        </div>
    )
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

const SingleView = ({
    rowId,
    entityId,
    isChat,
    isBusy,
    isRunning,
    inputOnly,
    result,
    resultHash,
    traceId,
    runRow,
    cancelRow,
    containerClassName,
    appType,
    renderTestsetButton,
}: Props) => {
    const variableIds = useAtomValue(executionItemController.selectors.variableKeys) as string[]
    const schemaInputKeys = useAtomValue(
        executionItemController.selectors.schemaInputKeys,
    ) as string[]
    const runnableQuery = useAtomValue(useMemo(() => runnableBridge.query(entityId), [entityId]))

     const providers = usePlaygroundUIOptional()
        const SyncStateTagSlot = providers?.renderSyncStateTag
    const loadableId = useAtomValue(
        useMemo(() => playgroundController.selectors.loadableId(), []),
    ) as string | null

    const openFocusDrawer = useSetAtom(openPlaygroundFocusDrawerAtom)
    const {currentResult, repetitionProps} = useRepetitionResult({
        rowId,
        entityId,
        result,
    })

    const executionRowIds = useAtomValue(
        executionItemController.selectors.executionRowIds,
    ) as string[]
    const testCaseNumber = useMemo(() => {
        const index = executionRowIds.indexOf(rowId)
        return index >= 0 ? index + 1 : null
    }, [executionRowIds, rowId])

    // Delete and duplicate handlers
    const deleteRow = useSetAtom(executionItemController.actions.deleteRow)
    const duplicateRow = useSetAtom(executionItemController.actions.duplicateRow)
    const rowCount = executionRowIds?.length || 0

    // Check if there are results for the add to testset button
    const hasResults = useMemo(() => {
        return Boolean(resultHash && result)
    }, [resultHash, result])

    // Global collapse state from header (collapse-all / expand-all)
    const isAllCollapsed = useAtomValue(executionItemController.selectors.allRowsCollapsed)

    // Local override: null = follow global, boolean = individual toggle
    const [localCollapsed, setLocalCollapsed] = useState<boolean | null>(null)

    // Reset local override when global state changes
    useEffect(() => {
        setLocalCollapsed(null)
    }, [isAllCollapsed])

    const isCollapsed = localCollapsed ?? isAllCollapsed
    const setIsCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
        setLocalCollapsed(typeof value === "function" ? value(isCollapsed) : value)
    }

    // Collapse state for individual input/output components
    const [collapsedVariableInputs, setCollapsedVariableInputs] = useState<Record<string, boolean>>(
        {},
    )
    // Stable ref map for variable container overflow detection
    const variableRefsMap = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map())
    const getVariableRef = useCallback((id: string) => {
        if (!variableRefsMap.current.has(id)) {
            variableRefsMap.current.set(id, React.createRef<HTMLDivElement>())
        }
        return variableRefsMap.current.get(id)!
    }, [])

    const [markdownToggles, setMarkdownToggles] = useState<
        Record<string, (() => void) | undefined>
    >({})

    const toggleVariableInputCollapse = useCallback((id: string) => {
        setCollapsedVariableInputs((prev) => ({...prev, [id]: !prev[id]}))
    }, [])
    const [isInitialLoadSettled, setIsInitialLoadSettled] = useState(false)
    const [hasInteractedWithCollapse, setHasInteractedWithCollapse] = useState(false)
    const isExecutionExpanded = inputOnly || !isCollapsed
    const isWaitingForVariableControls =
        variableIds.length === 0 && (schemaInputKeys.length > 0 || Boolean(runnableQuery.isPending))
    const collapseDurationMs = hasInteractedWithCollapse ? 300 : 0

    useEffect(() => {
        if (isInitialLoadSettled) return
        if (runnableQuery.isPending) return
        if (schemaInputKeys.length > 0 && variableIds.length === 0) return

        const frameId = requestAnimationFrame(() => {
            setIsInitialLoadSettled(true)
        })
        return () => cancelAnimationFrame(frameId)
    }, [isInitialLoadSettled, runnableQuery.isPending, schemaInputKeys.length, variableIds.length])

    if (inputOnly && variableIds.length === 0) {
        return null
    }

    const testsetButton = renderTestsetButton?.({
        results: result ? [result] : [],
        icon: false,
        children: (
            <EnhancedButton
                icon={<DatabaseIcon size={14} />}
                type="text"
                size="small"
                disabled={!hasResults}
                tooltipProps={{title: "Add to testset"}}
            />
        ),
    })

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
                    <CollapsibleGroupHeader
                        label={testCaseNumber ? `Test case ${testCaseNumber}` : "Test case"}
                        isCollapsed={isCollapsed}
                        onClick={() => {
                            setHasInteractedWithCollapse(true)
                            setIsCollapsed((prev) => !prev)
                        }}
                        className="text-gray-500"
                    />
                    {SyncStateTagSlot && loadableId && (
                        <SyncStateTagSlot rowId={rowId} loadableId={loadableId} />
                    )}
                    <div className="flex-1" />
                    <RowHeaderActions
                        rowId={rowId}
                        entityId={entityId}
                        rowCount={rowCount}
                        testsetButton={testsetButton}
                        deleteRow={deleteRow}
                        duplicateRow={duplicateRow}
                        openFocusDrawer={openFocusDrawer}
                        tooltipTitle={isCollapsed ? "Expand results" : "View all repeats"}
                        className={clsx(
                            "flex items-center gap-1 opacity-0 transition-opacity",
                            isCollapsed
                                ? "group-hover/item:opacity-100"
                                : "group-hover/header:opacity-100",
                        )}
                    />
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

            <HeightCollapse
                open={isExecutionExpanded}
                className={clsx({"pointer-events-none": !isExecutionExpanded})}
                contentClassName="w-full"
                durationMs={collapseDurationMs}
                animate={hasInteractedWithCollapse}
            >
                <div
                    className={clsx("flex flex-col gap-4 w-full", {
                        "flex flex-col gap-4 w-full": isChat,
                    })}
                >
                    {variableIds.length > 0 && (
                        <div className="flex flex-col gap-2 w-full">
                            {variableIds.map((id) => {
                                const isVariableInputCollapsed =
                                    collapsedVariableInputs[id] || false
                                return (
                                    <div
                                        key={id}
                                        className={clsx([
                                            "relative group/item px-0 py-2 w-full",
                                            "hover:[&_.collapse-icon]:opacity-100",
                                        ])}
                                    >
                                        <div className="relative w-full">
                                            <VariableControlAdapter
                                                entityId={entityId}
                                                variableKey={id}
                                                key={id}
                                                rowId={rowId}
                                                appType={appType}
                                                collapsed={isVariableInputCollapsed}
                                                containerRef={getVariableRef(id)}
                                                className="*:!border-none w-full overflow-hidden"
                                                onMarkdownToggleReady={(toggle) => {
                                                    setMarkdownToggles((prev) => ({
                                                        ...(prev[id] === (toggle ?? undefined)
                                                            ? prev
                                                            : {
                                                                  ...prev,
                                                                  [id]: toggle ?? undefined,
                                                              }),
                                                    }))
                                                }}
                                                headerActions={
                                                    <>
                                                        <EnhancedButton
                                                            size="small"
                                                            type="text"
                                                            icon={<MarkdownLogoIcon size={14} />}
                                                            onClick={() => markdownToggles[id]?.()}
                                                            disabled={!markdownToggles[id]}
                                                            tooltipProps={{
                                                                title: "Preview markdown",
                                                            }}
                                                        />
                                                        <CopyVariableButton
                                                            rowId={rowId}
                                                            variableKey={id}
                                                        />
                                                        <CollapseToggleButton
                                                            className="collapse-icon"
                                                            collapsed={isVariableInputCollapsed}
                                                            onToggle={() =>
                                                                toggleVariableInputCollapse(id)
                                                            }
                                                            contentRef={getVariableRef(id)}
                                                        />
                                                    </>
                                                }
                                                editorProps={{enableTokens: false}}
                                            />
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
                {!inputOnly && !isWaitingForVariableControls ? (
                    <div
                        className={clsx(["w-full flex flex-col gap-4 pb-2 relative group/output"])}
                    >
                        <div className="relative w-full">
                            <ExecutionResultView
                                isRunning={isBusy}
                                currentResult={currentResult}
                                traceId={traceId ?? null}
                                repetitionProps={repetitionProps}
                            />
                        </div>
                    </div>
                ) : null}
            </HeightCollapse>
        </div>
    )
}

export default SingleView
