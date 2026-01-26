/**
 * useDerivedState Hook
 *
 * Computes derived state from playground nodes, connections, and loadable data.
 * Centralizes memoized computations to keep the main component clean.
 *
 * This hook transforms controller state into view model types for UI consumption.
 * Supports both legacy single-session results and multi-session results.
 */

import {useMemo} from "react"

import {revision} from "@agenta/entities"
import {
    type OutputConnection,
    type RunnableType,
    type PlaygroundNode,
    type ExtraColumn,
    type RowExecutionResult,
    type TestsetColumn,
    type TestsetRow,
    type EntitySelection,
} from "@agenta/entities/runnable"
import {atom, useAtomValue} from "jotai"

import type {RunResult, ExecutionSession} from "../state/execution"
import type {
    ChainExecutionResult,
    EntityInfo,
    OutputReceiverInfo,
    RunnableNode,
} from "../state/types"

interface LoadableState {
    connectedSourceId: string | null
    columns: TestsetColumn[]
    rows: TestsetRow[]
    executionResults: Record<string, RowExecutionResult>
    activeRow?: TestsetRow | null
}

/**
 * Multi-session execution results keyed by stepId, then sessionId
 */
export interface MultiSessionExecutionResults {
    /** Results keyed by stepId -> sessionId -> result */
    byStepSession: Record<string, Record<string, RunResult>>
    /** Active sessions for column rendering */
    sessions: ExecutionSession[]
    /** Whether in compare mode */
    isCompareMode: boolean
}

export interface DerivedStateParams {
    primaryNode: PlaygroundNode | null
    nodes: PlaygroundNode[]
    allConnections: OutputConnection[]
    editingConnectionId: string | null
    loadable: LoadableState
    extraColumns: ExtraColumn[]
    /** Optional multi-session results (for compare mode) */
    multiSessionResults?: MultiSessionExecutionResults
}

/**
 * Hook for computing derived state from playground data
 *
 * Transforms controller state (PlaygroundNode, OutputConnection, etc.)
 * into view model types (RunnableNode, OutputReceiverInfo, etc.)
 * for UI component consumption.
 */
export function useDerivedState({
    primaryNode,
    nodes,
    allConnections,
    editingConnectionId,
    loadable,
    extraColumns,
    multiSessionResults,
}: DerivedStateParams) {
    // Convert primary node to the format expected by UI components
    const primaryNodeEntity = useMemo((): EntitySelection | null => {
        if (!primaryNode) return null
        return {
            type: primaryNode.entityType as EntitySelection["type"],
            id: primaryNode.entityId,
            label: primaryNode.label ?? primaryNode.entityId,
        }
    }, [primaryNode])

    // Convert nodes to RunnableNode format for UI components
    const runnableNodes = useMemo((): RunnableNode[] => {
        return nodes.map((node) => ({
            id: node.id,
            entity: {
                type: node.entityType as EntitySelection["type"],
                id: node.entityId,
                label: node.label ?? node.entityId,
            },
            depth: "depth" in node && typeof node.depth === "number" ? node.depth : 0,
        }))
    }, [nodes])

    // Compute the loadable ID for the current primary runnable's testcases
    const loadableId = useMemo(
        () =>
            primaryNodeEntity ? `testset:${primaryNodeEntity.type}:${primaryNodeEntity.id}` : "",
        [primaryNodeEntity],
    )

    // Get the connected revision version (for commit modal)
    const connectedRevisionAtom = useMemo(
        () =>
            atom((get) => {
                if (!loadable.connectedSourceId) return null
                const dataAtom = revision.data(loadable.connectedSourceId)
                return get(dataAtom)
            }),
        [loadable.connectedSourceId],
    )
    const connectedRevisionData = useAtomValue(connectedRevisionAtom)

    // Combine runnable columns with extra columns
    const columns = useMemo(() => {
        return [
            ...loadable.columns,
            ...extraColumns.map((col) => ({
                key: col.key,
                name: col.name,
                type: col.type as "string",
                required: false,
            })),
        ]
    }, [loadable.columns, extraColumns])

    // Derive supplied columns from testcase data (keys present in rows)
    const suppliedColumns = useMemo(() => {
        if (loadable.rows.length === 0) return []
        const keySet = new Set<string>()
        loadable.rows.forEach((row) => {
            Object.keys(row.data).forEach((key) => keySet.add(key))
        })
        return Array.from(keySet).map((key) => ({
            key,
            name: key,
        }))
    }, [loadable.rows])

    // Compute output receivers for ConfigPanel
    const outputReceivers = useMemo<OutputReceiverInfo[]>(() => {
        if (!primaryNode) return []

        return allConnections
            .filter((c) => c.sourceNodeId === primaryNode.id)
            .map((connection) => {
                const targetNode = runnableNodes.find((n) => n.id === connection.targetNodeId)
                if (!targetNode || !targetNode.entity) return null

                const validMappings = connection.inputMappings.filter(
                    (m) => m.status === "valid",
                ).length
                const inputPorts =
                    "inputPorts" in targetNode && Array.isArray(targetNode.inputPorts)
                        ? targetNode.inputPorts
                        : []
                const requiredInputs = inputPorts.filter(
                    (p) => typeof p === "object" && p !== null && "required" in p && p.required,
                ).length

                return {
                    connection,
                    entity: targetNode.entity,
                    validMappings,
                    requiredInputs,
                }
            })
            .filter((r): r is OutputReceiverInfo => r !== null)
    }, [primaryNode, allConnections, runnableNodes])

    // Execution results from the loadable - transform to ChainExecutionResult format
    // This is the legacy single-session format
    const executionResults = useMemo<Record<string, ChainExecutionResult>>(() => {
        const results: Record<string, ChainExecutionResult> = {}
        for (const [rowId, rowExecState] of Object.entries(loadable.executionResults)) {
            results[rowId] = {
                status: rowExecState.status,
                output: rowExecState.output,
                error: rowExecState.error,
                traceId: rowExecState.traceId,
                chainProgress: rowExecState.chainProgress,
                chainResults: rowExecState.chainResults,
                isChain: rowExecState.isChain,
                totalStages: rowExecState.totalStages,
            } as ChainExecutionResult
        }
        return results
    }, [loadable.executionResults])

    // Multi-session execution results (for compare mode)
    // Transforms RunResult to ChainExecutionResult for UI compatibility
    const sessionExecutionResults = useMemo<Record<
        string,
        Record<string, ChainExecutionResult>
    > | null>(() => {
        if (!multiSessionResults?.byStepSession) return null

        const results: Record<string, Record<string, ChainExecutionResult>> = {}
        for (const [stepId, sessionResults] of Object.entries(multiSessionResults.byStepSession)) {
            results[stepId] = {}
            for (const [sessionId, runResult] of Object.entries(sessionResults)) {
                results[stepId][sessionId] = {
                    status: runResult.status,
                    output: runResult.output,
                    error: runResult.error,
                    traceId: runResult.traceId,
                    chainProgress: runResult.chainProgress,
                    chainResults: runResult.chainResults,
                    isChain: runResult.isChain,
                    totalStages: runResult.totalStages,
                } as ChainExecutionResult
            }
        }
        return results
    }, [multiSessionResults?.byStepSession])

    // Session info for compare mode column rendering
    const compareSessions = useMemo(
        () => multiSessionResults?.sessions ?? [],
        [multiSessionResults?.sessions],
    )

    const isCompareMode = useMemo(
        () => multiSessionResults?.isCompareMode ?? false,
        [multiSessionResults?.isCompareMode],
    )

    // Get the editing connection for mapping modal
    const editingConnection = useMemo(
        () => allConnections.find((c) => c.id === editingConnectionId) || null,
        [allConnections, editingConnectionId],
    )

    // Get source/target nodes for the editing connection
    const editingSourceNode = useMemo(() => {
        if (!editingConnection) return null
        return runnableNodes.find((n) => n.id === editingConnection.sourceNodeId)
    }, [editingConnection, runnableNodes])

    const editingTargetNode = useMemo(() => {
        if (!editingConnection) return null
        return runnableNodes.find((n) => n.id === editingConnection.targetNodeId)
    }, [editingConnection, runnableNodes])

    // Create entity info for the mapping modal
    const sourceEntityInfo = useMemo((): EntityInfo | null => {
        if (!editingSourceNode) return null
        return {
            type: editingSourceNode.entity.type as RunnableType,
            id: editingSourceNode.entity.id,
            label: editingSourceNode.entity.label || editingSourceNode.entity.id,
        }
    }, [editingSourceNode])

    const targetEntityInfo = useMemo((): EntityInfo | null => {
        if (!editingTargetNode) return null
        return {
            type: editingTargetNode.entity.type as RunnableType,
            id: editingTargetNode.entity.id,
            label: editingTargetNode.entity.label || editingTargetNode.entity.id,
        }
    }, [editingTargetNode])

    return {
        primaryNodeEntity,
        runnableNodes,
        loadableId,
        connectedRevisionData,
        columns,
        suppliedColumns,
        outputReceivers,
        // Legacy single-session results
        executionResults,
        // Multi-session results (for compare mode)
        sessionExecutionResults,
        compareSessions,
        isCompareMode,
        // Mapping modal state
        editingConnection,
        sourceEntityInfo,
        targetEntityInfo,
    }
}
