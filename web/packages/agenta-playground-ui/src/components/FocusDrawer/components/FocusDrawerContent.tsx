import React, {useMemo} from "react"

import type {PlaygroundNode} from "@agenta/entities/runnable"
import {runnableBridge} from "@agenta/entities/runnable"
import {executionItemController, playgroundController} from "@agenta/playground"
import {Collapse} from "antd"
import {atom} from "jotai"
import {useAtomValue} from "jotai"

import {usePlaygroundUI} from "../../../context"
import {playgroundFocusDrawerAtom} from "../../../state"
import ExecutionResultView from "../../ExecutionResultView"
import {EvaluatorFieldGrid} from "../../shared/EvaluatorFieldGrid"
import {extractDisplayEntries} from "../../shared/EvaluatorFieldGrid/utils"

// ============================================================================
// SUB-COMPONENT: Single input variable
// ============================================================================

function InputVariable({rowId, variableKey}: {rowId: string; variableKey: string}) {
    const {SimpleSharedEditor} = usePlaygroundUI()
    const value = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.testcaseCellValue({
                    testcaseId: rowId,
                    column: variableKey,
                }),
            [rowId, variableKey],
        ),
    ) as string | undefined

    if (!SimpleSharedEditor) return null

    return (
        <SimpleSharedEditor
            value={String(value ?? "")}
            initialValue={String(value ?? "")}
            defaultMinimized
            isJSON={false}
            isMinimizeVisible
            isFormatVisible={false}
            headerName={variableKey}
            editorType="border"
            headerClassName="text-[#1677FF]"
        />
    )
}

// ============================================================================
// SUB-COMPONENT: Primary output for an entity
// ============================================================================

function PrimaryOutput({rowId, entityId}: {rowId: string; entityId: string}) {
    const fullResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId,
                }),
            [rowId, entityId],
        ),
    ) as {status?: string; output?: unknown; traceId?: string | null; error?: unknown} | null

    const status = fullResult?.status
    const isRunning = status === "running" || status === "pending"
    const traceId = (fullResult?.traceId as string | null) ?? null
    const output = fullResult?.output ?? null
    const error = fullResult?.error

    const currentResult = useMemo(() => {
        if (!fullResult || status === "idle") return null
        if (error) {
            const errorMsg =
                typeof error === "object" && error !== null
                    ? ((error as {message?: string}).message ?? JSON.stringify(error))
                    : String(error)
            return {error: errorMsg}
        }
        return output as {response?: unknown; error?: unknown} | null
    }, [fullResult, status, error, output])

    return (
        <ExecutionResultView
            isRunning={isRunning}
            currentResult={currentResult}
            traceId={traceId}
            showEmptyPlaceholder={false}
        />
    )
}

// ============================================================================
// SUB-COMPONENT: Downstream node result (evaluator)
// ============================================================================

function DownstreamOutput({
    rowId,
    node,
    nodeName,
}: {
    rowId: string
    node: PlaygroundNode
    nodeName: string
}) {
    const fullResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId: node.entityId,
                }),
            [rowId, node.entityId],
        ),
    ) as {status?: string; output?: unknown} | null

    // Read output ports from the runnable bridge (includes per-field schema)
    const outputPorts = useAtomValue(
        useMemo(
            () => runnableBridge.forType(node.entityType).outputPorts(node.entityId),
            [node.entityType, node.entityId],
        ),
    )

    const status = fullResult?.status ?? "idle"

    // Idle / cancelled / no result -> hidden
    if (!fullResult || status === "idle" || status === "cancelled") {
        return null
    }

    const isLoading = status === "running" || status === "pending"
    const entries = isLoading ? null : extractDisplayEntries(fullResult.output)

    // Success but no displayable data -> hidden
    if (!isLoading && !entries) return null

    return (
        <div className="pt-3 mt-3 border-0 border-t border-solid border-[var(--ant-color-border-secondary)]">
            <span className="text-sm font-medium text-[var(--ant-color-text)]">{nodeName}</span>
            <EvaluatorFieldGrid
                entries={entries}
                outputPorts={outputPorts}
                loading={isLoading}
                className="mt-2"
            />
        </div>
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const FocusDrawerContent = () => {
    const {rowId, entityId} = useAtomValue(playgroundFocusDrawerAtom)
    const variableKeys = useAtomValue(executionItemController.selectors.variableKeys) as string[]

    // Chain nodes for downstream results
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), [])) as
        | PlaygroundNode[]
        | null
    const isChain = (nodes?.length ?? 0) > 1
    const primaryEntityId = entityId || ""

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
        return nodes.filter((n) => n.depth > 0 && n.entityId !== primaryEntityId)
    }, [isChain, nodes, primaryEntityId])

    if (!rowId) return null

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            {/* Input Section */}
            <Collapse
                defaultActiveKey={["input"]}
                expandIconPlacement="end"
                bordered={false}
                style={{background: "transparent", borderRadius: 0}}
                styles={{
                    header: {borderRadius: 0, userSelect: "none", padding: "10px 16px"},
                    body: {borderRadius: 0, padding: "16px 24px"},
                }}
                items={[
                    {
                        key: "input",
                        label: "Input",
                        children: (
                            <div className="flex flex-col gap-2">
                                {variableKeys.map((key) => (
                                    <InputVariable key={key} rowId={rowId} variableKey={key} />
                                ))}
                                {variableKeys.length === 0 && (
                                    <div className="text-gray-400">No inputs available</div>
                                )}
                            </div>
                        ),
                    },
                ]}
            />
            {/* Output Section */}
            <Collapse
                defaultActiveKey={["output"]}
                expandIconPlacement="end"
                bordered={false}
                style={{background: "transparent", borderRadius: 0}}
                styles={{
                    header: {borderRadius: 0, userSelect: "none", padding: "10px 16px"},
                    body: {borderRadius: 0, padding: "16px 24px"},
                }}
                items={[
                    {
                        key: "output",
                        label: "Outputs",
                        children: (
                            <div className="flex flex-col">
                                {/* Primary output */}
                                <PrimaryOutput rowId={rowId} entityId={primaryEntityId} />

                                {/* Downstream node outputs (evaluators) */}
                                {downstreamNodes.map((node) => {
                                    const resolvedName = nodeNames[node.id]
                                    const label =
                                        resolvedName ||
                                        (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                                            ? node.label
                                            : node.entityType.charAt(0).toUpperCase() +
                                              node.entityType.slice(1))
                                    return (
                                        <DownstreamOutput
                                            key={node.entityId}
                                            rowId={rowId}
                                            node={node}
                                            nodeName={label}
                                        />
                                    )
                                })}
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    )
}

export default FocusDrawerContent
