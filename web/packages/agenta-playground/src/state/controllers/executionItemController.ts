/**
 * Execution Item Controller
 *
 * Unified controller for execution items — the primary data unit the UI renders.
 * An execution item represents a single row in the playground: its inputs,
 * messages (chat mode), execution lifecycle, and results.
 *
 * ## Usage
 *
 * ```typescript
 * import { executionItemController } from '@agenta/playground'
 * import { useAtomValue, useSetAtom } from 'jotai'
 *
 * // Read item data
 * const rows = useAtomValue(executionItemController.selectors.executionRowIds)
 * const result = useAtomValue(executionItemController.selectors.resolvedResult({ rowId, entityId }))
 * const messageIds = useAtomValue(executionItemController.selectors.messageIds)
 *
 * // Trigger execution
 * const run = useSetAtom(executionItemController.actions.triggerTest)
 * const cancel = useSetAtom(executionItemController.actions.cancelTests)
 *
 * // Mutate chat messages
 * const addMessage = useSetAtom(executionItemController.actions.addUserMessage)
 * const patchMessage = useSetAtom(executionItemController.actions.patchMessage)
 * ```
 */

import {
    messageIdsWithContextAtom,
    messagesByIdWithContextAtom,
    addUserMessageWithContextAtom,
    addMessageWithContextAtom,
    patchMessageWithContextAtom,
    deleteMessageWithContextAtom,
    truncateChatWithContextAtom,
    clearSessionResponsesWithContextAtom,
} from "../chat"
import {
    executionRowIdsAtom,
    generationRowIdsAtom,
    generationVariableRowIdsAtom,
    renderableExecutionItemsAtom,
    renderableExecutionRowsAtom,
    renderableExecutionItemsByRowAtomFamily,
    renderableExecutionItemsByExecutionIdAtomFamily,
    executionRowIdsForEntityAtomFamily,
    resolvedGenerationResultAtomFamily,
    fullResultByRowEntityAtomFamily,
    runStatusByRowEntityAtom,
    generationHeaderDataAtomFamily,
    rowDataWithContextAtomFamily,
    rowVariableValueAtomFamily,
    rowVariableKeysWithContextAtom,
    schemaInputKeysAtom,
    inputPortSchemaMapAtom,
    outputPortSchemaMapAtom,
    repetitionCountAtom,
    repetitionIndexAtomFamily,
    allRowsCollapsedAtom,
    triggerExecutionAtom,
    triggerExecutionsAtom,
    cancelTestsMutationAtom,
    clearAllRunsMutationAtom,
    clearAllExecutionItemsMutationAtom,
    clearResponseByRowEntityWithContextAtom,
    setRepetitionCountAtom,
    setRepetitionIndexAtom,
    isAnyRunningForRowAtomFamily,
    responseByRowEntityAtomFamily,
    appTypeAtom,
    executionHeadersAtom,
    executionWorkerBridgeAtom,
    handleExecutionResultFromWorkerAtom,
    addRowWithContextAtom,
    deleteRowWithContextAtom,
    duplicateRowWithContextAtom,
    setRowValueWithContextAtom,
    isBusyForRowAtomFamily,
    chainExecutionStatusAtomFamily,
    aggregatedHeaderDataAtom,
    assistantForTurnAtomFamily,
    toolsForTurnAtomFamily,
    assistantsForTurnAtomFamily,
    rerunFromTurnAtom,
    runAllWithContextAtom,
    runRowAtom,
    runRowStepAtom,
    cancelRowAtom,
    cancelAllWithContextAtom,
    testcaseCellValueAtomFamily,
    testcaseDataAtomFamily,
    setTestcaseCellValueAtom,
    downstreamNodeQueriesAtom,
    rowVariableKeysAtomFamily,
} from "../execution"
import {buildAssistantMessage} from "../helpers/messageFactory"

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

export const executionItemController = {
    /**
     * Selectors — read execution item state
     */
    selectors: {
        // ----------------------------------------------------------------
        // Row / item enumeration
        // ----------------------------------------------------------------

        /** Execution row IDs (all rows, both modes) */
        executionRowIds: executionRowIdsAtom,

        /** Generation row IDs (turns in chat, rows in completion) */
        generationRowIds: generationRowIdsAtom,

        /** Variable-input row IDs (shared variable row in chat, all rows in completion) */
        generationVariableRowIds: generationVariableRowIdsAtom,

        /** Flattened renderable execution items (rowId × executionId) */
        renderableItems: renderableExecutionItemsAtom,

        /** Renderable execution items grouped by row */
        renderableRows: renderableExecutionRowsAtom,

        /** Renderable execution items for a specific row */
        itemsByRow: (rowId: string) => renderableExecutionItemsByRowAtomFamily(rowId),

        /** Renderable execution items for a specific execution ID */
        itemsByExecutionId: (executionId: string) =>
            renderableExecutionItemsByExecutionIdAtomFamily(executionId),

        /** Deduplicated row IDs for a specific entity */
        rowIdsForEntity: (entityId: string) => executionRowIdsForEntityAtomFamily(entityId),

        // ----------------------------------------------------------------
        // Per-item result / lifecycle
        // ----------------------------------------------------------------

        /** Resolved generation result (result, hash, trace, running) by row+entity */
        resolvedResult: (params: {entityId: string; rowId: string}) =>
            resolvedGenerationResultAtomFamily(params),

        /** Full result (output/error/trace) by row+entity */
        fullResult: (params: {rowId: string; entityId: string}) =>
            fullResultByRowEntityAtomFamily(params),

        /** Run status map keyed by rowId:entityId */
        runStatusByRowEntity: runStatusByRowEntityAtom,

        /** Response data (output only) by row+entity */
        responseByRowEntity: (params: {rowId: string; entityId: string}) =>
            responseByRowEntityAtomFamily(params),

        /** App type: "chat" | "completion" | undefined while loading */
        appType: appTypeAtom,

        /** Header aggregate data for an entity */
        headerData: (entityId: string) => generationHeaderDataAtomFamily(entityId),

        // ----------------------------------------------------------------
        // Per-item inputs
        // ----------------------------------------------------------------

        /** Current row data by rowId */
        rowData: (rowId: string) => rowDataWithContextAtomFamily(rowId),

        /** Single variable value for a row+variable */
        rowVariableValue: (params: {rowId: string; variableId: string}) =>
            rowVariableValueAtomFamily(params),

        /** Variable keys derived from the linked runnable columns */
        variableKeys: rowVariableKeysWithContextAtom,

        /** Variable keys keyed on downstream node IDs — use this in components
         *  that also subscribe to playgroundNodesAtom to avoid stale values */
        variableKeysForDownstream: (downstreamKey: string) =>
            rowVariableKeysAtomFamily(downstreamKey),

        /** Subscribe to downstream evaluator node queries to ensure they're mounted.
         * atomWithQuery only fetches when it has a React subscriber. */
        downstreamNodeQueries: downstreamNodeQueriesAtom,

        /** Schema-derived input keys for custom app variable gating */
        schemaInputKeys: schemaInputKeysAtom,

        /** Input port schema map — variable key → { type, schema } for schema-aware rendering */
        inputPortSchemaMap: inputPortSchemaMapAtom,

        /**
         * Output port schema map — mirrors `inputPortSchemaMap` but for
         * output fields. Feeds the prompt editor's typeahead so evaluator
         * prompts can suggest `$.outputs.<field>` based on declared /
         * inferred output schemas.
         */
        outputPortSchemaMap: outputPortSchemaMapAtom,

        // ----------------------------------------------------------------
        // Direct testcase entity access (bypasses loadable indirection)
        // ----------------------------------------------------------------

        /** Direct cell value from testcase entity — fine-grained, no .find() scan */
        testcaseCellValue: (params: {testcaseId: string; column: string}) =>
            testcaseCellValueAtomFamily(params),

        /** Direct testcase entity data — full data record */
        testcaseData: (testcaseId: string) => testcaseDataAtomFamily(testcaseId),

        // ----------------------------------------------------------------
        // Per-item messages (chat mode)
        // ----------------------------------------------------------------

        /** Ordered message IDs for the current loadable context */
        messageIds: messageIdsWithContextAtom,

        /** Messages by ID for the current loadable context */
        messagesById: messagesByIdWithContextAtom,

        // ----------------------------------------------------------------
        // Repetitions
        // ----------------------------------------------------------------

        /** Global repetition count */
        repetitionCount: repetitionCountAtom,

        /** Repetition index for a row+entity pair */
        repetitionIndex: (params: {rowId: string; entityId: string}) =>
            repetitionIndexAtomFamily(`${params.rowId}:${params.entityId}`),

        // ----------------------------------------------------------------
        // Layout
        // ----------------------------------------------------------------

        /** Whether all execution rows are collapsed */
        allRowsCollapsed: allRowsCollapsedAtom,

        /** Whether any entity is running for a given row ID */
        isAnyRunningForRow: (rowId: string) => isAnyRunningForRowAtomFamily(rowId),

        /** Whether any entity is busy for a row (single or multi-entity) */
        isBusyForRow: (params: {rowId: string; entityId?: string}) =>
            isBusyForRowAtomFamily(params),

        /** Composite chain execution status for a row across ordered entities */
        chainExecutionStatus: (params: {rowId: string; entityIds: string[]}) =>
            chainExecutionStatusAtomFamily(params),

        /** Aggregated header data across all displayed entities (comparison view) */
        aggregatedHeaderData: aggregatedHeaderDataAtom,

        /** Assistant message for a specific turn and session */
        assistantForTurn: (params: {turnId: string; sessionId: string}) =>
            assistantForTurnAtomFamily(params),

        /** Tool messages for a specific turn and session */
        toolsForTurn: (params: {turnId: string; sessionId: string}) =>
            toolsForTurnAtomFamily(params),

        /** All assistant messages for a specific turn and session (chronological) */
        assistantsForTurn: (params: {turnId: string; sessionId: string}) =>
            assistantsForTurnAtomFamily(params),
    },

    /**
     * Actions — mutate execution item state
     */
    actions: {
        // ----------------------------------------------------------------
        // Execution lifecycle
        // ----------------------------------------------------------------

        /** Trigger execution for a single execution item */
        triggerTest: triggerExecutionAtom,

        /** Trigger execution for a step across multiple execution IDs */
        triggerTests: triggerExecutionsAtom,

        /** Cancel running tests (supports row/entity filters) */
        cancelTests: cancelTestsMutationAtom,

        /** Cancel all running tests across all entities */
        cancelAll: cancelAllWithContextAtom,

        /** Clear all run results */
        clearAllRuns: clearAllRunsMutationAtom,

        /** Clear run results and completion-mode testcase inputs */
        clearAll: clearAllExecutionItemsMutationAtom,

        /** Run all tests (handles chat/completion × single/comparison) */
        runAll: runAllWithContextAtom,

        /** Run a single row (across all variants or a specific entity) */
        runRow: runRowAtom,

        /** Run a specific chain step for a single row */
        runRowStep: runRowStepAtom,

        /** Cancel a single row (across all variants or a specific entity) */
        cancelRow: cancelRowAtom,

        /** Re-run from a specific chat turn (truncate + trigger) */
        rerunFromTurn: rerunFromTurnAtom,

        /** Clear cached response for row+entity */
        clearResponse: clearResponseByRowEntityWithContextAtom,

        // ----------------------------------------------------------------
        // Repetitions
        // ----------------------------------------------------------------

        /** Set repetition count */
        setRepetitionCount: setRepetitionCountAtom,

        /** Set repetition index for row+entity */
        setRepetitionIndex: setRepetitionIndexAtom,

        // ----------------------------------------------------------------
        // Layout
        // ----------------------------------------------------------------

        /** Toggle collapse-all / expand-all for execution rows */
        setAllRowsCollapsed: allRowsCollapsedAtom,

        // ----------------------------------------------------------------
        // Worker bridge (infra setup, consumed by OSS providers)
        // ----------------------------------------------------------------

        /** Set execution auth headers provider */
        setExecutionHeaders: executionHeadersAtom,

        /** Set execution worker bridge */
        setExecutionWorkerBridge: executionWorkerBridgeAtom,

        /** Handle web worker result (processes execution results) */
        handleWebWorkerResult: handleExecutionResultFromWorkerAtom,

        // ----------------------------------------------------------------
        // Chat messages (chat mode)
        // ----------------------------------------------------------------

        /** Add a user message turn */
        addUserMessage: addUserMessageWithContextAtom,

        /** Add a message (assistant/tool/system) to the current chat context */
        addMessage: addMessageWithContextAtom,

        /** Patch (edit) a specific message */
        patchMessage: patchMessageWithContextAtom,

        /** Delete a specific message */
        deleteMessage: deleteMessageWithContextAtom,

        /** Truncate chat after a turn (for re-run) */
        truncateChat: truncateChatWithContextAtom,

        /** Clear all session-scoped responses after a user message (session-safe re-run) */
        clearSessionResponses: clearSessionResponsesWithContextAtom,

        // ----------------------------------------------------------------
        // Row mutations
        // ----------------------------------------------------------------

        /** Add a new row (handles local testset init) */
        addRow: addRowWithContextAtom,

        /** Delete a row by ID */
        deleteRow: deleteRowWithContextAtom,

        /** Duplicate a row by ID */
        duplicateRow: duplicateRowWithContextAtom,

        /** Set a row value by key */
        setRowValue: setRowValueWithContextAtom,

        /** Direct testcase cell update — bypasses loadable indirection */
        setTestcaseCellValue: setTestcaseCellValueAtom,
    },

    /**
     * Helpers — pure utility functions
     */
    helpers: {
        /** Build an assistant message from content */
        buildAssistantMessage,
    },
}
