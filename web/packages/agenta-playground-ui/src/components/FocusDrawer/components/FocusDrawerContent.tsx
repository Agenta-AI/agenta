import React, {useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {runnableBridge} from "@agenta/entities/runnable"
import {RunnableOutputValue} from "@agenta/entity-ui"
import {executionItemController, playgroundController} from "@agenta/playground"
import {Collapse} from "antd"
import {atom} from "jotai"
import {useAtomValue} from "jotai"

import {usePlaygroundUI} from "../../../context"
import {playgroundFocusDrawerAtom} from "../../../state"
import ExecutionResultView from "../../ExecutionResultView"

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
    const {SharedGenerationResultUtils} = usePlaygroundUI()

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
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Output</span>
                {SharedGenerationResultUtils && traceId && (
                    <SharedGenerationResultUtils traceId={traceId} showStatus />
                )}
            </div>
            <ExecutionResultView
                isRunning={isRunning}
                currentResult={currentResult}
                traceId={traceId}
            />
        </div>
    )
}

// ============================================================================
// SUB-COMPONENT: Downstream node result (evaluator)
// ============================================================================

/** Convert snake_case/camelCase key to human-readable label */
function formatFieldLabel(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase())
}

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

    const schemaMap = useMemo(() => {
        const map: Record<string, SchemaProperty | undefined> = {}
        for (const port of outputPorts) {
            map[port.key] = port.schema as SchemaProperty | undefined
        }
        return map
    }, [outputPorts])

    if (!fullResult || fullResult.status === "idle" || !fullResult.output) {
        return null
    }

    // Extract display data — same path as SingleLayout DownstreamNodeResult
    const output = fullResult.output as Record<string, unknown> | undefined
    const responseData = output?.response as Record<string, unknown> | undefined
    const nestedData = responseData?.data as Record<string, unknown> | undefined
    const displayData = nestedData?.outputs ?? responseData?.outputs ?? nestedData ?? responseData

    if (!displayData || typeof displayData !== "object") return null

    const entries = Object.entries(displayData).filter(([, v]) => v !== undefined && v !== null)
    if (entries.length === 0) return null

    return (
        <div className="p-3 border-0 border-t border-solid border-[var(--ant-color-border-secondary)]">
            <span className="text-sm font-medium text-[var(--ant-color-text)]">{nodeName}</span>
            <div
                className="grid items-baseline leading-5 mt-2"
                style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4}}
            >
                {entries.map(([key, value]) => (
                    <React.Fragment key={key}>
                        <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap">
                            {formatFieldLabel(key)}:
                        </span>
                        <span className="break-words min-w-0">
                            <RunnableOutputValue value={value} schema={schemaMap[key]} />
                        </span>
                    </React.Fragment>
                ))}
            </div>
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
                classNames={{
                    header: "bg-[#05172905] !rounded-none select-none",
                    body: "!rounded-none bg-white !p-3",
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
                classNames={{
                    header: "bg-[#05172905] !rounded-none select-none",
                    body: "!rounded-none bg-white !p-0",
                }}
                items={[
                    {
                        key: "output",
                        label: "Outputs",
                        children: (
                            <div className="flex flex-col">
                                {/* Primary output */}
                                <div className="p-3">
                                    <PrimaryOutput rowId={rowId} entityId={primaryEntityId} />
                                </div>

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
