/**
 * usePlaygroundState Hook
 *
 * Thin React wrapper for accessing playground controller state and actions.
 * All business logic lives in controllers - this hook just connects them to React.
 *
 * @see playgroundController for state management
 * @see outputConnectionController for connection management
 */

import {useMemo} from "react"

import {type OutputConnection} from "@agenta/entities/runnable"
import {useAtomValue, useSetAtom} from "jotai"

import {playgroundController, outputConnectionController} from "../state"

/**
 * Hook for accessing playground controller state and actions
 *
 * This is a thin wrapper around playgroundController and outputConnectionController.
 * Use this in React components for convenient access to playground state.
 *
 * @example
 * ```typescript
 * const {
 *   primaryNode,
 *   nodes,
 *   addPrimaryNode,
 *   connectToTestset,
 * } = usePlaygroundState()
 * ```
 */
export function usePlaygroundState() {
    // Dispatch for standard actions via playgroundController.dispatch
    const dispatch = useSetAtom(playgroundController.dispatch)

    // Selectors via playgroundController.selectors.X()
    const primaryNode = useAtomValue(
        useMemo(() => playgroundController.selectors.primaryNode(), []),
    )
    const hasMultipleNodes = useAtomValue(
        useMemo(() => playgroundController.selectors.hasMultipleNodes(), []),
    )
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const connectedTestset = useAtomValue(
        useMemo(() => playgroundController.selectors.connectedTestset(), []),
    )
    const extraColumns = useAtomValue(
        useMemo(() => playgroundController.selectors.extraColumns(), []),
    )

    // Modal state via playgroundController.selectors
    const isTestsetModalOpen = useAtomValue(
        useMemo(() => playgroundController.selectors.testsetModalOpen(), []),
    )
    const isMappingModalOpen = useAtomValue(
        useMemo(() => playgroundController.selectors.mappingModalOpen(), []),
    )
    const editingConnectionId = useAtomValue(
        useMemo(() => playgroundController.selectors.editingConnectionId(), []),
    )

    // Output connections via outputConnectionController.selectors
    const allConnections = useAtomValue(
        useMemo(() => outputConnectionController.selectors.allConnections(), []),
    ) as OutputConnection[]

    // Compound actions via playgroundController.actions
    const addPrimaryNode = useSetAtom(playgroundController.actions.addPrimaryNode)
    const addDownstreamNode = useSetAtom(playgroundController.actions.addDownstreamNode)
    const removeNode = useSetAtom(playgroundController.actions.removeNode)
    const changePrimaryNode = useSetAtom(playgroundController.actions.changePrimaryNode)
    const disconnectAndResetToLocal = useSetAtom(
        playgroundController.actions.disconnectAndResetToLocal,
    )

    // WP1: Testset connection compound actions
    const connectToTestset = useSetAtom(playgroundController.actions.connectToTestset)
    const importTestcases = useSetAtom(playgroundController.actions.importTestcases)

    // WP2: Row with init compound action
    const addRowWithInit = useSetAtom(playgroundController.actions.addRowWithInit)

    // WP3: Extra column compound actions
    const addExtraColumn = useSetAtom(playgroundController.actions.addExtraColumn)
    const removeExtraColumn = useSetAtom(playgroundController.actions.removeExtraColumn)

    // WP4: Output mapping column compound action
    const addOutputMappingColumn = useSetAtom(playgroundController.actions.addOutputMappingColumn)

    // Connection actions via outputConnectionController.actions
    const addConnectionAction = useSetAtom(outputConnectionController.actions.addConnection)
    const removeConnectionAction = useSetAtom(outputConnectionController.actions.removeConnection)
    const clearConnectionsAction = useSetAtom(outputConnectionController.actions.clearConnections)
    const updateMappingsAction = useSetAtom(outputConnectionController.actions.updateMappings)

    return {
        // State
        dispatch,
        primaryNode,
        hasMultipleNodes,
        nodes,
        connectedTestset,
        extraColumns,
        isTestsetModalOpen,
        isMappingModalOpen,
        editingConnectionId,
        allConnections,

        // Compound actions
        addPrimaryNode,
        addDownstreamNode,
        removeNode,
        changePrimaryNode,
        disconnectAndResetToLocal,

        // WP1: Testset connection compound actions
        connectToTestset,
        importTestcases,

        // WP2: Row with init compound action
        addRowWithInit,

        // WP3: Extra column compound actions
        addExtraColumn,
        removeExtraColumn,

        // WP4: Output mapping column compound action
        addOutputMappingColumn,

        // Connection actions
        addConnectionAction,
        removeConnectionAction,
        clearConnectionsAction,
        updateMappingsAction,
    }
}
