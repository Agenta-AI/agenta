import React, {useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {runnableBridge} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {RunnableOutputValue} from "@agenta/entity-ui"
import {executionItemController, playgroundController} from "@agenta/playground"
import {getEvaluatorVerdictFromOutput} from "@agenta/playground/utils"
import clsx from "clsx"
import {atom} from "jotai"
import {useAtomValue} from "jotai"

import {useExecutionCell} from "../../../hooks/useExecutionCell"
import {useRunnableLoading} from "../../../hooks/useRunnableLoading"
import CompletionMode from "../../ExecutionItems/assets/CompletionMode"
import ExecutionResultView from "../../ExecutionResultView"
import {EvaluatorFieldGrid} from "../../shared/EvaluatorFieldGrid"
import {
    extractDisplayEntries,
    buildSchemaMap,
    formatFieldLabel,
} from "../../shared/EvaluatorFieldGrid/utils"
import {NodeResultCard, ensureNodeCardKeyframes, type NodeStatus} from "../../shared/NodeResultCard"

// Inject CSS keyframes for NodeResultCard animations (runs once)
ensureNodeCardKeyframes()

// ============================================================================
// SUB-COMPONENT: Downstream node card for comparison cells
// ============================================================================

const DownstreamNodeCard = ({
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
}) => {
    // Session key is scoped per-variant: sess:rootEntityId:nodeEntityId
    // so comparison mode results don't collide.
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

    const rawStatus = (fullResult?.status ?? "idle") as NodeStatus
    const evaluatorVerdict = getEvaluatorVerdictFromOutput(fullResult?.output)
    const status: NodeStatus =
        rawStatus === "success" && evaluatorVerdict === "fail" ? "error" : rawStatus

    if (!fullResult || rawStatus === "idle" || rawStatus === "cancelled") {
        return (
            <NodeResultCard name={nodeName} status={status}>
                <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} idle />
            </NodeResultCard>
        )
    }

    if (rawStatus === "running" || rawStatus === "pending") {
        return (
            <NodeResultCard name={nodeName} status={status}>
                <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} loading />
            </NodeResultCard>
        )
    }

    if (rawStatus === "error") {
        const errorMsg =
            typeof fullResult.error === "object" && fullResult.error?.message
                ? fullResult.error.message
                : "Error"
        return (
            <NodeResultCard name={nodeName} status={status}>
                <span className="text-[var(--ant-color-error)] text-xs leading-5">{errorMsg}</span>
            </NodeResultCard>
        )
    }

    // Skipped — show explanation message (e.g., missing required inputs)
    if (rawStatus === "skipped") {
        const skipMsg =
            typeof fullResult.error === "object" && fullResult.error?.message
                ? fullResult.error.message
                : "Skipped"
        return (
            <NodeResultCard name={nodeName} status={status}>
                <span className="text-[var(--ant-color-text-tertiary)] text-xs leading-5 italic">
                    {skipMsg}
                </span>
            </NodeResultCard>
        )
    }

    const entries = extractDisplayEntries(fullResult.output)
    const completedStatus: NodeStatus = evaluatorVerdict === "fail" ? "error" : "success"

    if (!entries || entries.length === 0) {
        return (
            <NodeResultCard name={nodeName} status={completedStatus}>
                <span className="text-xs leading-5">—</span>
            </NodeResultCard>
        )
    }

    return (
        <NodeResultCard name={nodeName} status={completedStatus}>
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
    const {
        isRunning,
        currentResult,
        displayResult,
        status,
        errorMessage,
        traceId,
        repetitionProps,
    } = useExecutionCell({
        entityId: entityId,
        stepId: rowId,
    })
    const effectiveDisplayResult =
        status === "error"
            ? {error: errorMessage ?? "Error"}
            : (displayResult ?? currentResult ?? null)
    const primaryNodeStatus: NodeStatus =
        isRunning || status === "running" || status === "pending"
            ? "running"
            : status === "error"
              ? "error"
              : status === "cancelled"
                ? "cancelled"
                : status === "skipped"
                  ? "skipped"
                  : status === "success"
                    ? "success"
                    : effectiveDisplayResult
                      ? "success"
                      : "idle"

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

    // Human-readable label for the primary (depth-0) node
    const primaryNodeLabel = useMemo(() => {
        const primary = nodes?.find((n) => n.entityId === entityId)
        if (!primary) return "Output"
        const resolvedName = nodeNames[primary.id]
        return (
            resolvedName ||
            (primary.label && !/^[0-9a-f]{8}-/.test(primary.label)
                ? primary.label
                : primary.entityType.charAt(0).toUpperCase() + primary.entityType.slice(1))
        )
    }, [nodes, entityId, nodeNames])

    // Feedback config for schema-aware result rendering
    const primaryData = useAtomValue(useMemo(() => runnableBridge.data(entityId), [entityId]))
    const feedbackConfig =
        (primaryData?.configuration?.feedback_config as Record<string, unknown>) ?? null

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
                <div className="!w-full shrink-0 sticky top-9 z-[1] flex flex-col gap-3 px-3 py-2">
                    {/* Primary node */}
                    <NodeResultCard name={primaryNodeLabel} status={primaryNodeStatus}>
                        <div className="min-w-0">
                            <ExecutionResultView
                                isRunning={isRunning}
                                currentResult={effectiveDisplayResult}
                                traceId={traceId}
                                repetitionProps={repetitionProps}
                                feedbackConfig={feedbackConfig}
                            />
                        </div>
                    </NodeResultCard>
                    {/* Downstream nodes: only render when primary has been run */}
                    {(effectiveDisplayResult || isRunning) &&
                        downstreamNodes.map((node) => {
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
                                    rootEntityId={entityId}
                                />
                            )
                        })}
                </div>
            </div>
        </>
    )
}

export default GenerationComparisonCompletionOutput
