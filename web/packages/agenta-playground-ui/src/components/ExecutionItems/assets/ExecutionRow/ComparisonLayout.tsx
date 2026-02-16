import React, {useCallback, useMemo} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {executionItemController, playgroundController} from "@agenta/playground"
import {DropdownButton} from "@agenta/ui/components"
import type {DropdownButtonOption, DropdownButtonOptionStatus} from "@agenta/ui/components"
import {EnhancedButton, RunButton} from "@agenta/ui/components/presentational"
import {CopySimpleIcon, MinusCircleIcon, PlayIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {atom} from "jotai"
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

    // Chain nodes for per-step execution
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), [])) as
        | PlaygroundNode[]
        | null
    const isChain = (nodes?.length ?? 0) > 1

    // Resolve human-readable names for each node from runnableBridge
    const nodeNamesAtom = useMemo(
        () =>
            atom((get) => {
                if (!nodes) return {} as Record<string, string>
                const names: Record<string, string> = {}
                for (const node of nodes) {
                    const data = get(runnableBridge.dataForType(node.entityType, node.entityId))
                    if (data?.name) {
                        names[node.id] = data.name
                    }
                }
                return names
            }),
        [nodes],
    )
    const nodeNames = useAtomValue(nodeNamesAtom)

    // Per-step execution action
    const runRowStepAction = useSetAtom(executionItemController.actions.runRowStep)

    // Read per-node execution status for dropdown indicators
    const nodeStatusesAtom = useMemo(
        () =>
            atom((get) => {
                if (!nodes) return {} as Record<string, DropdownButtonOptionStatus>
                const statuses: Record<string, DropdownButtonOptionStatus> = {}
                for (const node of nodes) {
                    const result = get(
                        executionItemController.selectors.fullResult({
                            rowId,
                            entityId: node.entityId,
                        }),
                    ) as {status?: string} | null
                    if (!result || !result.status || result.status === "idle") {
                        statuses[node.entityId] = "idle"
                    } else if (result.status === "running" || result.status === "pending") {
                        statuses[node.entityId] = "running"
                    } else if (result.status === "success") {
                        statuses[node.entityId] = "success"
                    } else {
                        statuses[node.entityId] = "error"
                    }
                }
                return statuses
            }),
        [nodes, rowId],
    )
    const nodeStatuses = useAtomValue(nodeStatusesAtom)

    // Read the full RunResult to check if the row has been executed
    const fullRunResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId: entityId ?? "",
                }),
            [rowId, entityId],
        ),
    )
    const hasSuccessfulRun = fullRunResult?.status === "success"

    // Build dropdown options for per-step execution
    const stepOptions: DropdownButtonOption[] = useMemo(() => {
        if (!isChain || !nodes || !entityId) return []
        const sortedNodes = [...nodes].sort((a, b) => a.depth - b.depth)
        return sortedNodes.map((node, index) => {
            const isDownstream = index > 0
            const canRun = isDownstream ? hasSuccessfulRun : true
            const resolvedName = nodeNames[node.id]
            const nodeLabel =
                resolvedName ||
                (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                    ? node.label
                    : node.entityType.charAt(0).toUpperCase() + node.entityType.slice(1))
            return {
                key: node.entityId,
                label: `Run ${nodeLabel}`,
                icon: <PlayIcon size={14} />,
                disabled: !canRun,
                status: nodeStatuses[node.entityId] ?? "idle",
            }
        })
    }, [isChain, nodes, entityId, nodeNames, hasSuccessfulRun, nodeStatuses])

    // Run the full chain — triggers execution from the primary entity.
    // The chain runner handles the full topological order internally.
    const handleRunChain = useCallback(() => {
        runRow()
    }, [runRow])

    // Run a specific chain step — always dispatches from the primary entity,
    // with targetNodeId scoping execution to just that stage.
    const handleStepSelect = useCallback(
        (key: string) => {
            runRowStepAction({rowId, entityId: entityId ?? "", targetNodeId: key})
        },
        [runRowStepAction, rowId, entityId],
    )

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
                    {isChain ? (
                        <DropdownButton
                            label={isBusy ? "Running" : "Run"}
                            icon={<PlayIcon size={14} />}
                            size="small"
                            options={stepOptions}
                            onClick={isBusy ? cancelRow : handleRunChain}
                            onOptionSelect={handleStepSelect}
                            loading={isBusy}
                        />
                    ) : isBusy ? (
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
