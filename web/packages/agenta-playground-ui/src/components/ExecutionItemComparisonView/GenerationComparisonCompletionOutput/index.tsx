import React, {useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {runnableBridge} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {RunnableOutputValue} from "@agenta/entity-ui"
import {executionItemController, playgroundController} from "@agenta/playground"
import {LoadingOutlined} from "@ant-design/icons"
import {Tag} from "antd"
import clsx from "clsx"
import {atom} from "jotai"
import {useAtomValue} from "jotai"

import {useExecutionCell} from "../../../hooks/useExecutionCell"
import {useRunnableLoading} from "../../../hooks/useRunnableLoading"
import CompletionMode from "../../ExecutionItems/assets/CompletionMode"
import ExecutionResultView from "../../ExecutionResultView"

// ============================================================================
// HELPERS
// ============================================================================

/** Convert snake_case/camelCase key to human-readable label */
function formatLabel(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase())
}

// ============================================================================
// SUB-COMPONENT: Downstream node result (evaluator) for comparison cells
// ============================================================================

const DownstreamNodeResult = ({
    rowId,
    node,
    nodeName,
}: {
    rowId: string
    node: PlaygroundNode
    nodeName: string
}) => {
    const fullResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId: node.entityId,
                }),
            [rowId, node.entityId],
        ),
    ) as {status?: string; output?: unknown; error?: {message: string} | null} | null

    const outputPorts = useAtomValue(
        useMemo(
            () => runnableBridge.forType(node.entityType).outputPorts(node.entityId),
            [node.entityType, node.entityId],
        ),
    )

    const schemaMap = useMemo(() => {
        const map: Record<string, SchemaProperty | undefined> = {}
        for (const port of outputPorts) {
            map[port.key] = port.schema as SchemaProperty | undefined
        }
        return map
    }, [outputPorts])

    const status = fullResult?.status ?? "idle"

    const renderContent = () => {
        if (!fullResult || status === "idle" || status === "cancelled") {
            return <span className="text-[#bdc7d1]">Pending run</span>
        }
        if (status === "running" || status === "pending") {
            return (
                <span className="flex items-center gap-1 text-[#bdc7d1]">
                    <LoadingOutlined style={{fontSize: 12}} spin />
                    Running...
                </span>
            )
        }
        if (status === "error") {
            const errorMsg =
                typeof fullResult.error === "object" && fullResult.error?.message
                    ? fullResult.error.message
                    : "Error"
            return <span className="text-[var(--ant-color-error)]">{errorMsg}</span>
        }

        const output = fullResult.output as Record<string, unknown> | undefined
        const responseData = output?.response as Record<string, unknown> | undefined
        const nestedData = responseData?.data as Record<string, unknown> | undefined
        const displayData =
            nestedData?.outputs ?? responseData?.outputs ?? nestedData ?? responseData

        if (!displayData || typeof displayData !== "object") return <span>—</span>

        const entries = Object.entries(displayData).filter(([, v]) => v !== undefined && v !== null)
        if (entries.length === 0) return <span>—</span>

        if (entries.length === 1) {
            const [key, value] = entries[0]
            return <RunnableOutputValue value={value} schema={schemaMap[key]} />
        }

        return (
            <div
                className="grid items-baseline text-xs leading-5"
                style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4}}
            >
                {entries.map(([key, value]) => (
                    <React.Fragment key={key}>
                        <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap leading-5">
                            {formatLabel(key)}:
                        </span>
                        <span className="break-words min-w-0 leading-5">
                            <RunnableOutputValue value={value} schema={schemaMap[key]} />
                        </span>
                    </React.Fragment>
                ))}
            </div>
        )
    }

    return (
        <div className="flex items-start gap-2">
            <div className="shrink-0 h-6 flex items-center">
                <Tag
                    variant="filled"
                    className="!m-0 rounded-[6px] px-2 py-[1px] text-xs leading-[22px] bg-[#0517290F] text-[#344054] border border-solid border-transparent"
                >
                    {nodeName}
                </Tag>
            </div>
            <div className="flex-1 min-w-0 text-xs leading-5 break-words text-[var(--ant-color-text)]">
                {renderContent()}
            </div>
        </div>
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface GenerationComparisonCompletionOutputProps {
    rowId: string
    entityId: string
    variantIndex: number
    isLastRow?: boolean
    isLastVariant?: boolean
}

const GenerationComparisonCompletionOutput = ({
    rowId,
    entityId,
    variantIndex,
    isLastRow,
}: GenerationComparisonCompletionOutputProps) => {
    const isLoading = useRunnableLoading(entityId)
    const {isRunning, currentResult, traceId, repetitionProps} = useExecutionCell({
        entityId: entityId,
        stepId: rowId,
    })

    // Chain nodes for downstream results
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), [])) as
        | PlaygroundNode[]
        | null
    const isChain = (nodes?.length ?? 0) > 1

    // Resolve human-readable names for downstream nodes
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

    const downstreamNodes = useMemo(() => {
        if (!isChain || !nodes) return []
        return nodes.filter((n) => n.depth > 0 && n.entityId !== entityId)
    }, [isChain, nodes, entityId])

    if (isLoading) {
        return (
            <>
                {variantIndex === 0 ? (
                    <div
                        className={clsx([
                            "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[99] !w-[400px]",
                            {"border-r": variantIndex === 0},
                            "shrink-0",
                        ])}
                    >
                        <div className="p-3">
                            <div className="h-12 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                        </div>
                    </div>
                ) : null}
                <div
                    className={clsx([
                        "!min-w-[400px] flex-1 shrink-0 bg-white z-[1]",
                        "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                    ])}
                >
                    <div className="p-3">
                        <div className="h-20 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                    </div>
                </div>
            </>
        )
    }

    return (
        <>
            {variantIndex === 0 ? (
                <div
                    className={clsx([
                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[99] !w-[400px]",
                        {"border-r": variantIndex === 0},
                        "shrink-0",
                    ])}
                >
                    <div className="w-full flex-1 shrink-0 sticky top-9 z-[2] border-0">
                        <CompletionMode rowId={rowId} withControls={isLastRow} />
                    </div>
                </div>
            ) : null}

            <div
                className={clsx([
                    "!min-w-[400px] flex-1 shrink-0 bg-white z-[1]",
                    "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                ])}
            >
                <div className="!w-full shrink-0 sticky top-9 z-[1]">
                    <ExecutionResultView
                        isRunning={isRunning}
                        currentResult={currentResult}
                        traceId={traceId}
                        repetitionProps={repetitionProps}
                    />
                </div>
                {downstreamNodes.length > 0 && (
                    <div className="flex flex-col gap-2 px-3 pb-3">
                        {downstreamNodes.map((node) => {
                            const resolvedName = nodeNames[node.id]
                            const label =
                                resolvedName ||
                                (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                                    ? node.label
                                    : node.entityType.charAt(0).toUpperCase() +
                                      node.entityType.slice(1))
                            return (
                                <DownstreamNodeResult
                                    key={node.entityId}
                                    rowId={rowId}
                                    node={node}
                                    nodeName={label}
                                />
                            )
                        })}
                    </div>
                )}
            </div>
        </>
    )
}

export default GenerationComparisonCompletionOutput
