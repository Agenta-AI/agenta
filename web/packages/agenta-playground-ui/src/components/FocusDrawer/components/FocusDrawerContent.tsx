import React, {useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {runnableBridge} from "@agenta/entities/runnable"
import {RunnableOutputValue} from "@agenta/entity-ui"
import {executionItemController, playgroundController} from "@agenta/playground"
import {Collapse} from "antd"
import {atom} from "jotai"
import {useAtomValue} from "jotai"

import {usePlaygroundUIOptional} from "../../../context/PlaygroundUIContext"
import {playgroundFocusDrawerAtom} from "../../../state"
import ExecutionResultView from "../../ExecutionResultView"
import {EvaluatorFieldGrid} from "../../shared/EvaluatorFieldGrid"
import {
    extractDisplayEntries,
    buildSchemaMap,
    formatFieldLabel,
} from "../../shared/EvaluatorFieldGrid/utils"
import {NodeResultCard, ensureNodeCardKeyframes, type NodeStatus} from "../../shared/NodeResultCard"

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

    // Feedback config for schema-aware result rendering
    const primaryData = useAtomValue(useMemo(() => runnableBridge.data(entityId), [entityId]))
    const feedbackConfig =
        (primaryData?.configuration?.feedback_config as Record<string, unknown>) ?? null

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
            feedbackConfig={feedbackConfig}
        />
    )
}

// Inject CSS keyframes for NodeResultCard animations (runs once)
ensureNodeCardKeyframes()

// ============================================================================
// SUB-COMPONENT: Downstream node card (evaluator)
// ============================================================================

function DownstreamNodeCard({
    rowId,
    node,
    nodeName,
    rootEntityId,
}: {
    rowId: string
    node: PlaygroundNode
    nodeName: string
    /** Parent variant's entity ID — scopes the result lookup per-variant */
    rootEntityId: string
}) {
    // Session key is scoped per-variant: sess:rootEntityId:nodeEntityId
    const scopedEntityId = `${rootEntityId}:${node.entityId}`
    const fullResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId: scopedEntityId,
                }),
            [rowId, scopedEntityId],
        ),
    ) as {status?: string; output?: unknown; error?: {message: string} | null} | null

    const outputPorts = useAtomValue(
        useMemo(
            () => runnableBridge.forType(node.entityType).outputPorts(node.entityId),
            [node.entityType, node.entityId],
        ),
    )
    const nodeData = useAtomValue(
        useMemo(() => runnableBridge.data(node.entityId), [node.entityId]),
    )

    const schemaMap = useMemo(() => {
        const map = buildSchemaMap(outputPorts)
        const fbConfig = nodeData?.configuration?.feedback_config as
            | Record<string, unknown>
            | undefined
        if (fbConfig) {
            const jsonSchema = fbConfig.json_schema as
                | {schema?: {properties?: {score?: Record<string, unknown>}}}
                | undefined
            const scoreConstraints = jsonSchema?.schema?.properties?.score
            if (scoreConstraints) {
                const existing = map.score ?? ({} as Record<string, unknown>)
                map.score = {...existing, ...scoreConstraints} as SchemaProperty
            }
        }
        return map
    }, [outputPorts, nodeData])

    const status = (fullResult?.status ?? "idle") as NodeStatus

    if (!fullResult || status === "idle" || status === "cancelled") {
        return (
            <NodeResultCard name={nodeName} status={status}>
                <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} idle />
            </NodeResultCard>
        )
    }

    if (status === "running" || status === "pending") {
        return (
            <NodeResultCard name={nodeName} status={status}>
                <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} loading />
            </NodeResultCard>
        )
    }

    if (status === "error") {
        const errorMsg =
            typeof fullResult.error === "object" &&
            (fullResult.error as {message?: string})?.message
                ? (fullResult.error as {message: string}).message
                : "Error"
        return (
            <NodeResultCard name={nodeName} status={status}>
                <span className="text-[var(--ant-color-error)] text-xs leading-5">{errorMsg}</span>
            </NodeResultCard>
        )
    }

    const entries = extractDisplayEntries(fullResult.output)

    if (!entries || entries.length === 0) {
        return (
            <NodeResultCard name={nodeName} status="success">
                <span className="text-xs leading-5">—</span>
            </NodeResultCard>
        )
    }

    return (
        <NodeResultCard name={nodeName} status="success">
            <div
                className="grid items-baseline text-xs leading-5"
                style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 6}}
            >
                {entries.map(([key, value]) => (
                    <React.Fragment key={key}>
                        <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap leading-5">
                            {formatFieldLabel(key)}:
                        </span>
                        <span className="break-words min-w-0 leading-5">
                            <RunnableOutputValue value={value} schema={schemaMap[key]} />
                        </span>
                    </React.Fragment>
                ))}
            </div>
        </NodeResultCard>
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const FocusDrawerContent = () => {
    const {rowId, entityId} = useAtomValue(playgroundFocusDrawerAtom)
    const providers = usePlaygroundUIOptional()
    const TestcaseEditor = providers?.TestcaseEditor

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
            {/* Data Section (testcase editor injected by OSS) */}
            {TestcaseEditor && <TestcaseEditor testcaseId={rowId} />}
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
                            <div className="flex flex-col gap-3">
                                {/* Primary node */}
                                <NodeResultCard
                                    name={(() => {
                                        const primary = nodes?.find(
                                            (n) => n.entityId === primaryEntityId,
                                        )
                                        if (!primary) return "Output"
                                        const resolvedName = nodeNames[primary.id]
                                        return (
                                            resolvedName ||
                                            (primary.label && !/^[0-9a-f]{8}-/.test(primary.label)
                                                ? primary.label
                                                : primary.entityType.charAt(0).toUpperCase() +
                                                  primary.entityType.slice(1))
                                        )
                                    })()}
                                >
                                    <div className="min-w-0">
                                        <PrimaryOutput rowId={rowId} entityId={primaryEntityId} />
                                    </div>
                                </NodeResultCard>
                                {/* Downstream nodes: each in its own bordered card */}
                                {downstreamNodes.map((node) => {
                                    const resolvedName = nodeNames[node.id]
                                    const label =
                                        resolvedName ||
                                        (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                                            ? node.label
                                            : node.entityType.charAt(0).toUpperCase() +
                                              node.entityType.slice(1))
                                    return (
                                        <DownstreamNodeCard
                                            key={node.entityId}
                                            rowId={rowId}
                                            node={node}
                                            nodeName={label}
                                            rootEntityId={primaryEntityId}
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
