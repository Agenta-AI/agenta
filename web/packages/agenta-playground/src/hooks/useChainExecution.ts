/**
 * useChainExecution Hook
 *
 * Extracts chain execution logic from PlaygroundContent.
 * Handles execution of single rows and all rows, supporting:
 * - Single runnable execution
 * - DAG-based chain execution with topological ordering
 * - Progress tracking during execution
 * - Error handling
 */

import {useCallback, useMemo} from "react"

import {
    useRunnable,
    useRunnableSelectors,
    type RunnableType,
    type RunnableData,
    type ExecutionResult,
    type StageExecutionResult,
    computeTopologicalOrder,
    resolveChainInputs,
    executeRunnable,
} from "@agenta/entities/runnable"
import {getDefaultStore, useAtomValue} from "jotai"

import {playgroundController, outputConnectionController} from "../state"
import type {EntitySelection} from "../components/EntitySelector"
import {useLoadable} from "../components/LoadableEntityPanel"
import type {OutputConnection} from "../state"

export interface RunnableNode {
    id: string
    entity: EntitySelection
    depth: number
}

export interface UseChainExecutionReturn {
    /** Execute a single testcase row */
    executeRow: (rowId: string, data: Record<string, unknown>) => Promise<void>
    /** Execute all testcase rows */
    executeAll: () => void
    /** Whether any execution is currently running */
    isExecuting: boolean
}

/**
 * Hook for managing chain execution in the playground
 *
 * @param loadableId - The loadable ID for the current primary runnable's testcases
 * @returns Functions to execute single rows or all rows, plus execution state
 */
export function useChainExecution(loadableId: string): UseChainExecutionReturn {
    // ========================================================================
    // CONTROLLER STATE
    // ========================================================================

    // Selectors via playgroundController.selectors
    const primaryNode = useAtomValue(
        useMemo(() => playgroundController.selectors.primaryNode(), []),
    )
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))

    // Output connections via outputConnectionController.selectors
    const allConnections = useAtomValue(
        useMemo(() => outputConnectionController.selectors.allConnections(), []),
    ) as OutputConnection[]

    // Runnable selectors for downstream node execution
    const runnableSelectors = useRunnableSelectors()

    // ========================================================================
    // DERIVED STATE
    // ========================================================================

    // Convert primary node to the format expected by useRunnable
    const primaryNodeEntity = useMemo((): EntitySelection | null => {
        if (!primaryNode) return null
        return {
            type: primaryNode.entityType as EntitySelection["type"],
            id: primaryNode.entityId,
            label: primaryNode.label,
        }
    }, [primaryNode])

    // Convert nodes to RunnableNode format
    const runnableNodes = useMemo((): RunnableNode[] => {
        return nodes.map((node) => ({
            id: node.id,
            entity: {
                type: node.entityType as EntitySelection["type"],
                id: node.entityId,
                label: node.label,
            },
            depth: "depth" in node && typeof node.depth === "number" ? node.depth : 0,
        }))
    }, [nodes])

    // Get the loadable instance to manage testcases
    const loadable = useLoadable(loadableId)

    // Get the primary runnable for execution
    const primaryRunnableHook = useRunnable(
        primaryNodeEntity?.type as RunnableType,
        primaryNodeEntity?.id || "",
    )

    // Check if any execution is currently running
    const isExecuting = useMemo(
        () => Object.values(loadable.executionResults).some((r) => r.status === "running"),
        [loadable.executionResults],
    )

    // ========================================================================
    // EXECUTION HANDLERS
    // ========================================================================

    /**
     * Execute a single testcase (with chain if connections exist)
     */
    const executeRow = useCallback(
        async (rowId: string, data: Record<string, unknown>) => {
            if (!primaryNode) return

            const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            const startedAt = new Date().toISOString()

            // Check if we have downstream nodes (chain execution)
            const downstreamConnections = allConnections.filter(
                (c) => c.sourceNodeId === primaryNode.id,
            )
            const isChain = downstreamConnections.length > 0

            // Build execution order for chain
            const executionOrder = isChain
                ? computeTopologicalOrder(
                      runnableNodes.map((n) => ({nodeId: n.id})),
                      allConnections,
                      primaryNode.id,
                  )
                : [primaryNode.id]

            const totalStages = executionOrder?.length || 1

            // Initialize chain results storage
            const chainResults: Record<string, StageExecutionResult> = {}

            // Set initial running state
            loadable.setRowExecutionResult({
                rowId,
                executionId,
                startedAt,
                status: "running",
                isChain,
                totalStages,
                chainProgress: {
                    currentStage: 1,
                    totalStages,
                    currentNodeId: primaryNode.id,
                    currentNodeLabel: primaryNode.label || "Primary",
                    currentNodeType: primaryNode.entityType,
                },
                chainResults: {},
            })

            try {
                // Execute each node in order
                const nodeResults: Record<string, ExecutionResult> = {}

                for (let stageIndex = 0; stageIndex < (executionOrder?.length || 1); stageIndex++) {
                    const nodeId = executionOrder?.[stageIndex] || primaryNode.id
                    const node = runnableNodes.find((n) => n.id === nodeId)

                    if (!node) {
                        console.warn(`[executeRow] Node not found: ${nodeId}`)
                        continue
                    }

                    // Update progress
                    loadable.setRowExecutionResult({
                        rowId,
                        executionId,
                        startedAt,
                        status: "running",
                        isChain,
                        totalStages,
                        chainProgress: {
                            currentStage: stageIndex + 1,
                            totalStages,
                            currentNodeId: nodeId,
                            currentNodeLabel: node.entity.label || `Stage ${stageIndex + 1}`,
                            currentNodeType: node.entity.type,
                        },
                        chainResults,
                    })

                    // Determine inputs for this node
                    let nodeInputs: Record<string, unknown>

                    if (nodeId === primaryNode.id) {
                        // Primary node uses testcase data
                        nodeInputs = data
                    } else {
                        // Downstream nodes resolve inputs from upstream results
                        // Pass testcase data for testcase.* mappings
                        nodeInputs = resolveChainInputs(allConnections, nodeId, nodeResults, data)
                    }

                    // Execute the node
                    let result: ExecutionResult | null

                    if (nodeId === primaryNode.id) {
                        // Use the hook for primary node (has proper state management)
                        result = await primaryRunnableHook.execute(nodeInputs)
                    } else {
                        // Get runnable data from store for downstream nodes
                        const store = getDefaultStore()
                        const dataAtom = runnableSelectors.data(
                            node.entity.type as RunnableType,
                            node.entity.id,
                        )
                        const runnableData = store.get(dataAtom) as RunnableData | null

                        if (!runnableData) {
                            throw new Error(
                                `No runnable data for ${node.entity.type}:${node.entity.id}`,
                            )
                        }

                        // Use executeRunnable directly for downstream nodes
                        result = await executeRunnable(
                            node.entity.type as RunnableType,
                            runnableData,
                            {inputs: nodeInputs},
                        )
                    }

                    // Handle null result
                    if (!result) {
                        throw new Error(`Execution returned null for node ${nodeId}`)
                    }

                    // Store result for input resolution
                    nodeResults[nodeId] = result

                    // Build stage result with trace ID
                    const stageResult: StageExecutionResult = {
                        executionId: result.executionId,
                        nodeId,
                        nodeLabel: node.entity.label || `Stage ${stageIndex + 1}`,
                        nodeType: node.entity.type,
                        stageIndex,
                        status: result.status,
                        startedAt: result.startedAt,
                        completedAt: result.completedAt,
                        output: result.output,
                        structuredOutput: result.structuredOutput,
                        error: result.error,
                        traceId: result.trace?.id || null,
                        metrics: result.metrics,
                    }

                    chainResults[nodeId] = stageResult

                    // Update state with the completed stage result
                    loadable.setRowExecutionResult({
                        rowId,
                        executionId,
                        startedAt,
                        status: "running",
                        isChain,
                        totalStages,
                        chainProgress: {
                            currentStage: stageIndex + 1,
                            totalStages,
                            currentNodeId: nodeId,
                            currentNodeLabel: node.entity.label || `Stage ${stageIndex + 1}`,
                            currentNodeType: node.entity.type,
                        },
                        chainResults,
                    })

                    // Stop on error
                    if (result.status === "error") {
                        loadable.setRowExecutionResult({
                            rowId,
                            executionId,
                            startedAt,
                            completedAt: new Date().toISOString(),
                            status: "error",
                            output: result.output,
                            error: result.error,
                            isChain,
                            totalStages,
                            chainProgress: null,
                            chainResults,
                        })
                        return
                    }
                }

                // Get primary node result for final output
                const primaryResult = nodeResults[primaryNode.id]

                // Set final success state
                loadable.setRowExecutionResult({
                    rowId,
                    executionId: primaryResult?.executionId || executionId,
                    startedAt: primaryResult?.startedAt || startedAt,
                    completedAt: new Date().toISOString(),
                    status: "success",
                    output: primaryResult?.output,
                    metrics: primaryResult?.metrics,
                    isChain,
                    totalStages,
                    chainProgress: null,
                    chainResults,
                })
            } catch (error) {
                // Set error state
                loadable.setRowExecutionResult({
                    rowId,
                    executionId,
                    startedAt,
                    completedAt: new Date().toISOString(),
                    status: "error",
                    error: {
                        message: error instanceof Error ? error.message : String(error),
                    },
                    isChain,
                    totalStages,
                    chainProgress: null,
                    chainResults,
                })
            }
        },
        [
            primaryNode,
            primaryRunnableHook,
            loadable,
            allConnections,
            runnableNodes,
            runnableSelectors,
        ],
    )

    /**
     * Execute all testcase rows
     */
    const executeAll = useCallback(() => {
        if (!primaryNode || loadable.rows.length === 0) return

        // Execute all rows
        for (const row of loadable.rows) {
            executeRow(row.id, row.data)
        }
    }, [primaryNode, loadable.rows, executeRow])

    return {
        executeRow,
        executeAll,
        isExecuting,
    }
}
