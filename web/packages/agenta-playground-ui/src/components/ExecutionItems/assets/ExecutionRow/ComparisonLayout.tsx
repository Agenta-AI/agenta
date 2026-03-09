import React, {useCallback, useMemo} from "react"

import type {PlaygroundNode} from "@agenta/entities/runnable"
import {executionItemController, playgroundController} from "@agenta/playground"
import {getEvaluatorVerdictFromOutput} from "@agenta/playground/utils"
import type {DropdownButtonOption, DropdownButtonOptionStatus} from "@agenta/ui/components"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {CopySimpleIcon, MinusCircleIcon, PlayIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {VariableControlAdapter} from "@agenta/playground-ui/adapters"

import {usePlaygroundUIOptional} from "../../../../context/PlaygroundUIContext"

import {ExecutionRowRunControl, usePlaygroundNodeLabels} from "./shared"

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
    const rootNodes = useMemo(
        () => (nodes ? nodes.filter((node) => node.depth === 0) : []),
        [nodes],
    )
    const downstreamNodes = useMemo(
        () => (nodes ? nodes.filter((node) => node.depth > 0) : []),
        [nodes],
    )
    const structuralRootNode = rootNodes[0] ?? null
    const hasDownstreamNodes = downstreamNodes.length > 0

    const {getNodeLabel} = usePlaygroundNodeLabels(nodes)

    const mapStatuses = useCallback(
        (results: ({status?: string; output?: unknown} | null)[]): DropdownButtonOptionStatus => {
            const relevant = results.filter(
                (result): result is {status?: string; output?: unknown} => Boolean(result),
            )
            if (relevant.length === 0) return "idle"
            if (
                relevant.some(
                    (result) => result.status === "running" || result.status === "pending",
                )
            ) {
                return "running"
            }
            if (
                relevant.some((result) => result.status === "error" || result.status === "failed")
            ) {
                return "error"
            }
            if (
                relevant.some(
                    (result) =>
                        result.status === "success" &&
                        getEvaluatorVerdictFromOutput(result.output) === "fail",
                )
            ) {
                return "error"
            }
            if (relevant.every((result) => result.status === "success")) {
                return "success"
            }
            return "idle"
        },
        [],
    )

    // Read per-node execution status for dropdown indicators
    const nodeStatusesAtom = useMemo(
        () =>
            atom((get) => {
                if (!structuralRootNode) return {} as Record<string, DropdownButtonOptionStatus>
                const statuses: Record<string, DropdownButtonOptionStatus> = {}

                statuses[structuralRootNode.entityId] = mapStatuses(
                    rootNodes.map((node) => {
                        const result = get(
                            executionItemController.selectors.fullResult({
                                rowId,
                                entityId: node.entityId,
                            }),
                        ) as {status?: string; output?: unknown} | null
                        return result
                    }),
                )

                for (const node of downstreamNodes) {
                    statuses[node.entityId] = mapStatuses(
                        rootNodes.map((rootNode) => {
                            const result = get(
                                executionItemController.selectors.fullResult({
                                    rowId,
                                    entityId: `${rootNode.entityId}:${node.entityId}`,
                                }),
                            ) as {status?: string; output?: unknown} | null
                            return result
                        }),
                    )
                }
                return statuses
            }),
        [downstreamNodes, mapStatuses, rootNodes, rowId, structuralRootNode],
    )
    const nodeStatuses = useAtomValue(nodeStatusesAtom)

    const hasSuccessfulRun = structuralRootNode
        ? nodeStatuses[structuralRootNode.entityId] === "success"
        : false

    // Build dropdown options for per-step execution
    const stepOptions: DropdownButtonOption[] = useMemo(() => {
        if (!structuralRootNode || !hasDownstreamNodes) return []

        return [structuralRootNode, ...downstreamNodes].map((node, index) => {
            const isDownstream = index > 0
            const canRun = isDownstream ? hasSuccessfulRun : true
            return {
                key: node.entityId,
                label:
                    index === 0 && rootNodes.length > 1
                        ? "Run revisions"
                        : `Run ${getNodeLabel(node)}`,
                icon: <PlayIcon size={14} />,
                disabled: !canRun,
                status: nodeStatuses[node.entityId] ?? "idle",
            }
        })
    }, [
        downstreamNodes,
        getNodeLabel,
        hasDownstreamNodes,
        hasSuccessfulRun,
        nodeStatuses,
        rootNodes.length,
        structuralRootNode,
    ])

    // Run the full chain — triggers execution from the primary entity.
    // The chain runner handles the full topological order internally.
    const handleRunChain = useCallback(() => {
        runRow()
    }, [runRow])

    const runRowStepAction = useSetAtom(executionItemController.actions.runRowStep)
    const handleStepSelect = useCallback(
        (key: string) => {
            runRowStepAction({rowId, targetNodeId: key})
        },
        [runRowStepAction, rowId],
    )
    const providers = usePlaygroundUIOptional()
    const SyncStateTagSlot = providers?.renderSyncStateTag
    const loadableId = useAtomValue(
        useMemo(() => playgroundController.selectors.loadableId(), []),
    ) as string | null

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
                    {SyncStateTagSlot && loadableId && (
                        <SyncStateTagSlot rowId={rowId} loadableId={loadableId} />
                    )}
                    <div className="flex-1" />
                    <ExecutionRowRunControl
                        showDropdown={hasDownstreamNodes}
                        stepOptions={stepOptions}
                        isBusy={isBusy}
                        onRun={handleRunChain}
                        onCancel={cancelRow}
                        onOptionSelect={handleStepSelect}
                        trigger={["click"]}
                    />
                </div>
            ) : null}
        </>
    )
}

export default ComparisonLayout
