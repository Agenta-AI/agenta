import {useMemo, Fragment} from "react"

import type {SchemaProperty} from "@agenta/entities"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {RunnableOutputValue} from "@agenta/entity-ui"
import {executionItemController, playgroundController} from "@agenta/playground"
import {Collapse, Tag} from "antd"
import {atom} from "jotai"
import {useAtomValue} from "jotai"

import {usePlaygroundUIOptional} from "../../../context/PlaygroundUIContext"
import {useRepetitionResult} from "../../../hooks/useRepetitionResult"
import {playgroundFocusDrawerAtom} from "../../../state"
import ExecutionResultView from "../../ExecutionResultView"
import {EvaluatorFieldGrid} from "../../shared/EvaluatorFieldGrid"
import {
    extractDisplayEntries,
    buildSchemaMap,
    formatFieldLabel,
    isVerdictFieldKey,
    parseBooleanLikeValue,
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
    ) as {
        status?: string
        output?: unknown
        traceId?: string | null
        error?: unknown
        repetitions?: {output?: unknown}[]
    } | null

    const status = fullResult?.status
    const isRunning = status === "running" || status === "pending"
    const traceId = (fullResult?.traceId as string | null) ?? null
    const repetitionOutputs =
        Array.isArray(fullResult?.repetitions) && fullResult.repetitions.length > 1
            ? fullResult.repetitions.map((rep, idx) => {
                  if (rep?.output !== undefined) return rep.output
                  return idx === 0 ? (fullResult?.output ?? null) : null
              })
            : null
    const output = repetitionOutputs ?? fullResult?.output ?? null
    const error = fullResult?.error
    const {currentResult: currentRepetitionResult, repetitionProps} = useRepetitionResult({
        rowId,
        entityId,
        result: output,
    })

    // Feedback config for schema-aware result rendering
    const primaryConfiguration = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const feedbackConfig =
        ((primaryConfiguration as Record<string, unknown> | null)?.feedback_config as Record<
            string,
            unknown
        >) ?? null

    const currentResult = useMemo(() => {
        if (!fullResult || status === "idle") return null
        if (error) {
            const errorMsg =
                typeof error === "object" && error !== null
                    ? ((error as {message?: string}).message ?? JSON.stringify(error))
                    : String(error)
            return {error: errorMsg}
        }
        return currentRepetitionResult as {response?: unknown; error?: unknown} | null
    }, [fullResult, status, error, currentRepetitionResult])

    return (
        <ExecutionResultView
            isRunning={isRunning}
            currentResult={currentResult}
            traceId={traceId}
            repetitionProps={repetitionProps}
            showEmptyPlaceholder
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
        useMemo(() => workflowMolecule.selectors.outputPorts(node.entityId), [node.entityId]),
    )
    const nodeConfiguration = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(node.entityId), [node.entityId]),
    )

    const schemaMap = useMemo(() => {
        const map = buildSchemaMap(outputPorts)
        const fbConfig = (nodeConfiguration as Record<string, unknown> | undefined)
            ?.feedback_config as Record<string, unknown> | undefined
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
    }, [outputPorts, nodeConfiguration])

    const rawStatus = (fullResult?.status ?? "idle") as NodeStatus

    if (!fullResult || rawStatus === "idle" || rawStatus === "cancelled") {
        return (
            <NodeResultCard name={nodeName} status={rawStatus}>
                <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} idle />
            </NodeResultCard>
        )
    }

    if (rawStatus === "running" || rawStatus === "pending") {
        return (
            <NodeResultCard name={nodeName} status={rawStatus}>
                <EvaluatorFieldGrid entries={null} outputPorts={outputPorts} loading />
            </NodeResultCard>
        )
    }

    if (rawStatus === "error") {
        const errorMsg =
            typeof fullResult.error === "object" &&
            (fullResult.error as {message?: string})?.message
                ? (fullResult.error as {message: string}).message
                : "Error"
        return (
            <NodeResultCard name={nodeName} status={rawStatus}>
                <span className="text-[var(--ant-color-error)] text-xs leading-5">{errorMsg}</span>
            </NodeResultCard>
        )
    }

    // Skipped — show explanation message (e.g., missing required inputs)
    if (rawStatus === "skipped") {
        const skipMsg =
            typeof fullResult.error === "object" &&
            (fullResult.error as {message?: string})?.message
                ? (fullResult.error as {message: string}).message
                : "Skipped"
        return (
            <NodeResultCard name={nodeName} status={rawStatus}>
                <span className="text-[var(--ant-color-text-tertiary)] text-xs leading-5 italic">
                    {skipMsg}
                </span>
            </NodeResultCard>
        )
    }

    const entries = extractDisplayEntries(fullResult.output)

    if (!entries || entries.length === 0) {
        return (
            <NodeResultCard name={nodeName} status={rawStatus}>
                <span className="text-xs leading-5">—</span>
            </NodeResultCard>
        )
    }

    return (
        <NodeResultCard name={nodeName} status={rawStatus}>
            <div
                className="grid items-baseline text-xs leading-5"
                style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 6}}
            >
                {entries.map(([key, value]) => (
                    <Fragment key={key}>
                        <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap leading-5">
                            {formatFieldLabel(key)}:
                        </span>
                        <span className="break-words min-w-0 leading-5">
                            {(() => {
                                const verdictBoolean = isVerdictFieldKey(key)
                                    ? parseBooleanLikeValue(value)
                                    : null
                                if (verdictBoolean === null) {
                                    return (
                                        <RunnableOutputValue
                                            value={value}
                                            schema={schemaMap[key]}
                                        />
                                    )
                                }
                                return (
                                    <Tag
                                        color={verdictBoolean ? "success" : "error"}
                                        className="!m-0 text-xs rounded-md px-2 py-0 leading-5"
                                    >
                                        {verdictBoolean ? "true" : "false"}
                                    </Tag>
                                )
                            })()}
                        </span>
                    </Fragment>
                ))}
            </div>
        </NodeResultCard>
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

function getNodeDisplayLabel(
    node: PlaygroundNode | undefined,
    nodeNames: Record<string, string>,
    fallback = "Output",
) {
    if (!node) return fallback
    const resolvedName = nodeNames[node.id]
    return (
        resolvedName ||
        (node.label && !/^[0-9a-f]{8}-/.test(node.label)
            ? node.label
            : node.entityType.charAt(0).toUpperCase() + node.entityType.slice(1))
    )
}

function VariantOutputColumn({
    rowId,
    entityId,
    nodeNames,
    downstreamNodes,
}: {
    rowId: string
    entityId: string
    nodeNames: Record<string, string>
    downstreamNodes: PlaygroundNode[]
}) {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), [])) as
        | PlaygroundNode[]
        | null

    const primary = useMemo(
        () => nodes?.find((node) => node.entityId === entityId),
        [nodes, entityId],
    )
    const primaryNodeLabel = useMemo(
        () => getNodeDisplayLabel(primary, nodeNames),
        [primary, nodeNames],
    )

    const primaryWorkflowData = useAtomValue(
        useMemo(() => workflowMolecule.selectors.data(entityId), [entityId]),
    )
    const primaryVersion = primaryWorkflowData?.version as number | undefined
    const primaryIsDraft = useMemo(() => isLocalDraftId(entityId), [entityId])

    return (
        <div className="min-w-[400px] flex-1 flex flex-col gap-3">
            <NodeResultCard
                name={primaryNodeLabel}
                version={primaryIsDraft ? undefined : primaryVersion}
                isDraft={primaryIsDraft}
            >
                <div className="min-w-0">
                    <PrimaryOutput rowId={rowId} entityId={entityId} />
                </div>
            </NodeResultCard>

            {downstreamNodes.map((node) => (
                <DownstreamNodeCard
                    key={`${entityId}:${node.entityId}`}
                    rowId={rowId}
                    node={node}
                    nodeName={getNodeDisplayLabel(node, nodeNames, node.entityType)}
                    rootEntityId={entityId}
                />
            ))}
        </div>
    )
}

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
    const rootNodes = useMemo(() => (nodes ? nodes.filter((n) => n.depth === 0) : []), [nodes])
    const isComparisonView = rootNodes.length > 1

    // Resolve human-readable names for downstream nodes
    const nodeNamesAtom = useMemo(
        () =>
            atom((get) => {
                if (!nodes) return {} as Record<string, string>
                const names: Record<string, string> = {}
                for (const node of nodes) {
                    const data = get(workflowMolecule.selectors.data(node.entityId))
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

    const compareDownstreamNodes = useMemo(() => {
        if (!isChain || !nodes) return []
        return nodes.filter((n) => n.depth > 0)
    }, [isChain, nodes])

    if (!rowId) return null

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            {/* Data Section (testcase editor injected by OSS) */}
            {TestcaseEditor && <TestcaseEditor testcaseId={rowId} />}
            {/* Output Section */}
            <Collapse
                defaultActiveKey={["output"]}
                expandIconPlacement="start"
                bordered={false}
                style={{background: "transparent", borderRadius: 0}}
                styles={{
                    header: {
                        borderRadius: 6,
                        userSelect: "none",
                        padding: "10px 16px",
                        background: "#FAFAFA",
                        border: "1px solid rgba(5,23,41,0.06)",
                    },
                    body: {borderRadius: 0, padding: "12px 16px"},
                }}
                items={[
                    {
                        key: "output",
                        label: "Outputs",
                        children: isComparisonView ? (
                            <div className="overflow-x-auto">
                                <div className="flex gap-4 min-w-fit">
                                    {rootNodes.map((rootNode) => (
                                        <VariantOutputColumn
                                            key={rootNode.entityId}
                                            rowId={rowId}
                                            entityId={rootNode.entityId}
                                            nodeNames={nodeNames}
                                            downstreamNodes={compareDownstreamNodes}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <NodeResultCard
                                    name={getNodeDisplayLabel(
                                        nodes?.find((n) => n.entityId === primaryEntityId),
                                        nodeNames,
                                    )}
                                >
                                    <div className="min-w-0">
                                        <PrimaryOutput rowId={rowId} entityId={primaryEntityId} />
                                    </div>
                                </NodeResultCard>
                                {downstreamNodes.map((node) => (
                                    <DownstreamNodeCard
                                        key={node.entityId}
                                        rowId={rowId}
                                        node={node}
                                        nodeName={getNodeDisplayLabel(
                                            node,
                                            nodeNames,
                                            node.entityType,
                                        )}
                                        rootEntityId={primaryEntityId}
                                    />
                                ))}
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    )
}

export default FocusDrawerContent
