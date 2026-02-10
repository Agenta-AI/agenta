/**
 * useTestsetHandlers Hook
 *
 * Handles testset connection operations:
 * - Connect/disconnect testset
 * - Edit selection
 * - Save as testset
 * - Commit changes
 *
 * Uses compound actions from playgroundController to ensure atomic state updates.
 */

import {useCallback, useState} from "react"

import {useBoundCommit} from "@agenta/entity-ui"
import {useRouter} from "next/router"

import type {
    TestsetSelectionMode,
    TestsetSelectionPayload,
    TestsetSavePayload,
} from "../../TestsetSelectionModal"

interface ConnectedTestset {
    name: string | null
    id: string | null
}

interface LoadableActions {
    connectedSourceId: string | null
    loadableId: string
    hasLocalChanges: boolean
    updateTestcaseSelection: (ids: string[]) => void
    discardChanges: () => void
}

interface RevisionData {
    name?: string | null
}

export interface TestsetHandlersParams {
    connectedTestset: ConnectedTestset | null
    loadable: LoadableActions
    disconnectAndResetToLocal: (loadableId: string) => void
    /** Connect to testset (load mode) - compound action from playgroundController */
    connectToTestset: (payload: {
        loadableId: string
        revisionId: string
        testcases: ({id?: string} & Record<string, unknown>)[]
        testsetName?: string
        testsetId?: string | null
        revisionVersion?: number | null
    }) => void
    /** Import testcases (import mode) - compound action from playgroundController */
    importTestcases: (payload: {loadableId: string; testcases: Record<string, unknown>[]}) => void
    connectedRevisionData: RevisionData | null
    rowCount: number
}

/**
 * Hook for testset connection operations
 *
 * Uses compound actions from playgroundController for atomic state updates.
 * The UI layer only manages modal visibility - all business logic is in the controller.
 */
export function useTestsetHandlers({
    connectedTestset,
    loadable,
    disconnectAndResetToLocal,
    connectToTestset,
    importTestcases,
    connectedRevisionData,
    rowCount,
}: TestsetHandlersParams) {
    const router = useRouter()

    // State for testset selection modal mode
    const [selectionModalMode, setSelectionModalMode] = useState<TestsetSelectionMode | null>(null)

    const handleConnectTestset = useCallback(() => {
        setSelectionModalMode("load")
    }, [])

    const handleNavigateToTestset = useCallback(() => {
        if (connectedTestset?.id) {
            const {workspace_id, project_id} = router.query
            router.push(`/w/${workspace_id}/p/${project_id}/testsets/${connectedTestset.id}`)
        }
    }, [connectedTestset, router])

    const handleDisconnectTestset = useCallback(() => {
        disconnectAndResetToLocal(loadable.loadableId)
    }, [disconnectAndResetToLocal, loadable.loadableId])

    const handleEditSelection = useCallback(() => {
        setSelectionModalMode("edit")
    }, [])

    /**
     * Handle testset selection confirmation
     *
     * Uses compound actions for atomic state updates:
     * - edit mode: Updates testcase selection via loadable
     * - load mode + import: Uses importTestcases compound action
     * - load mode + connect: Uses connectToTestset compound action
     */
    const handleSelectionConfirm = useCallback(
        (payload: TestsetSelectionPayload) => {
            if (selectionModalMode === "edit") {
                // Edit mode: just update selection (no connection state change)
                loadable.updateTestcaseSelection(payload.selectedTestcaseIds)
            } else if (selectionModalMode === "load") {
                if (payload.importMode === "import" && payload.testcases) {
                    // Import mode: use compound action (stays in local mode)
                    importTestcases({
                        loadableId: loadable.loadableId,
                        testcases: payload.testcases,
                    })
                } else {
                    // Connect mode: use compound action (atomically connects and updates state)
                    connectToTestset({
                        loadableId: loadable.loadableId,
                        revisionId: payload.revisionId,
                        testcases: payload.testcases ?? [],
                        testsetName: payload.testsetName,
                        testsetId: payload.testsetId,
                        revisionVersion: payload.revisionVersion,
                    })
                }
            }
            setSelectionModalMode(null)
        },
        [selectionModalMode, loadable, connectToTestset, importTestcases],
    )

    const handleSaveConfirm = useCallback(
        (payload: TestsetSavePayload) => {
            // Save mode: use connect compound action with just the revision info
            connectToTestset({
                loadableId: loadable.loadableId,
                revisionId: payload.revisionId,
                testcases: [],
                testsetName: payload.testsetName,
            })
            setSelectionModalMode(null)
        },
        [loadable.loadableId, connectToTestset],
    )

    const handleSelectionCancel = useCallback(() => {
        setSelectionModalMode(null)
    }, [])

    // Bound commit hook
    const {commit: openCommitModal} = useBoundCommit({
        type: "revision",
        id: loadable.connectedSourceId,
        name: connectedRevisionData?.name ?? "Testset",
        canCommit: loadable.hasLocalChanges,
        metadata: {loadableId: loadable.loadableId},
    })

    const handleDiscardChanges = useCallback(() => {
        loadable.discardChanges()
    }, [loadable])

    const handleOpenSaveTestsetModal = useCallback(() => {
        if (rowCount === 0) return
        setSelectionModalMode("save")
    }, [rowCount])

    return {
        selectionModalMode,
        handleConnectTestset,
        handleNavigateToTestset,
        handleDisconnectTestset,
        handleEditSelection,
        handleSelectionConfirm,
        handleSaveConfirm,
        handleSelectionCancel,
        openCommitModal,
        handleDiscardChanges,
        handleOpenSaveTestsetModal,
    }
}
