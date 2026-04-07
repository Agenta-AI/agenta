/**
 * LoadModeContent Component
 *
 * Unified content component for TestsetSelectionModal.
 * Handles both "load" (initial connection) and "edit" (modify selection) modes.
 * Also handles "create" mode (Build in UI) with name/commit inputs
 * and a Create & Load footer button.
 */

import {useCallback, useMemo, useState} from "react"

import {testcase} from "@agenta/entities"
import {loadableController} from "@agenta/entities/loadable"
import {testcasePaginatedStore} from "@agenta/entities/testcase"
import {TestcaseTable} from "@agenta/entity-ui"
import {Divider} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useTestsetSelection} from "../hooks/useTestsetSelection"
import type {PreviewPanelRenderProps, TestsetSelectionMode, TestsetSelectionPayload} from "../types"

import {SelectionSummary} from "./SelectionSummary"
import {TestsetSelectionPreview} from "./TestsetSelectionPreview"
import {TestsetSelectionSidebar} from "./TestsetSelectionSidebar"

export interface LoadModeContentProps {
    loadableId: string
    connectedRevisionId?: string
    onConfirm: (payload: TestsetSelectionPayload) => void
    onCancel: () => void
    /** Modal mode: 'load' for initial connection, 'edit' for modifying selection (default: 'load') */
    mode?: TestsetSelectionMode
    /** Selection mode: 'single' for radio-style, 'multiple' for checkboxes (default: 'multiple') */
    selectionMode?: "single" | "multiple"
    /** Optional render prop for the create card */
    renderCreateCard?: (props: {
        onTestsetCreated: (revisionId: string, testsetId: string) => void
        onBuildInUI: () => void
        isCreateMode: boolean
        onExitCreateMode: () => void
        newTestsetName: string
        onTestsetNameChange: (name: string) => void
        newTestsetCommitMessage: string
        onCommitMessageChange: (message: string) => void
    }) => React.ReactNode
    /** Optional render prop to replace the entire right panel (search + table) */
    renderPreviewPanel?: (props: PreviewPanelRenderProps) => React.ReactNode
    /** Warning message to show in the footer */
    warningMessage?: string
    /** Whether there is a compatibility warning */
    hasWarning?: boolean
    /** Called when "Create & Load" is clicked in create mode */
    onCreateAndLoad?: (params: {
        testsetName: string
        commitMessage: string
    }) => Promise<{success: boolean; revisionId?: string; testsetId?: string}>
}

export function LoadModeContent({
    loadableId: _loadableId,
    connectedRevisionId,
    onConfirm,
    onCancel,
    mode = "load",
    selectionMode = "multiple",
    renderCreateCard,
    renderPreviewPanel,
    warningMessage,
    hasWarning,
    onCreateAndLoad,
}: LoadModeContentProps) {
    const isEditMode = mode === "edit"

    // Keep the current row selection only in edit mode.
    // In load/change mode, seeding the draft with existing playground row IDs
    // causes the confirm payload to reconnect using those local rows instead of
    // the selected testset rows.
    const preselectedIds = useAtomValue(
        useMemo(() => loadableController.selectors.displayRowIds(_loadableId), [_loadableId]),
    )

    // Testset/revision selection (edit mode starts with connectedRevisionId)
    const {selectedRevisionId, selectedTestsetId, setSelection, revisionInfo} = useTestsetSelection(
        isEditMode ? connectedRevisionId : undefined,
        undefined,
        isEditMode ? preselectedIds : [],
    )

    // Testcase search term (used by default preview panel)
    const [testcaseSearchTerm, setTestcaseSearchTerm] = useState("")

    // ===================== Edit Mode =====================
    const isViewingConnected = (selectedRevisionId ?? undefined) === connectedRevisionId

    // ===================== Create Mode State =====================
    const [isCreateMode, setIsCreateMode] = useState(false)
    const [newTestsetName, setNewTestsetName] = useState("")
    const [newTestsetCommitMessage, setNewTestsetCommitMessage] = useState("")
    const [isCreating, setIsCreating] = useState(false)
    const [previousSelection, setPreviousSelection] = useState<{
        revisionId: string | null
        testsetId: string | null
    } | null>(null)

    const handleBuildInUI = useCallback(() => {
        setPreviousSelection({
            revisionId: selectedRevisionId,
            testsetId: selectedTestsetId,
        })
        setIsCreateMode(true)
        setNewTestsetName("")
        setNewTestsetCommitMessage("")
        setSelection("new", "")
    }, [setSelection, selectedRevisionId, selectedTestsetId])

    const handleExitCreateMode = useCallback(() => {
        setIsCreateMode(false)
        setNewTestsetName("")
        setNewTestsetCommitMessage("")
        if (previousSelection) {
            setSelection(previousSelection.revisionId, previousSelection.testsetId)
            setPreviousSelection(null)
        } else {
            setSelection(null, null)
        }
    }, [setSelection, previousSelection])

    // ===================== Selection State =====================
    const setSelectionDraft = useSetAtom(testcase.actions.setSelectionDraft)
    const commitSelectionDraft = useSetAtom(testcase.actions.commitSelectionDraft)
    const discardSelectionDraft = useSetAtom(testcase.actions.discardSelectionDraft)

    const draftKey = selectedRevisionId ?? "local"

    const currentSelection = useAtomValue(
        useMemo(() => testcase.atoms.currentSelection(draftKey), [draftKey]),
    )

    // Get paginated rows
    const paginatedParams = useMemo(
        () => ({
            scopeId: `testcase-selection-${draftKey}`,
            pageSize: 100,
        }),
        [draftKey],
    )
    const stateAtom = useMemo(
        () => testcasePaginatedStore.selectors.state(paginatedParams),
        [paginatedParams],
    )
    const {rows: allPaginatedRows} = useAtomValue(stateAtom)
    const paginatedRows = useMemo(
        () => allPaginatedRows.filter((row) => !row.__isNew && !row.__isSkeleton),
        [allPaginatedRows],
    )

    // ===================== Handlers =====================
    const handleSelectionChange = useCallback(
        (selectedIds: string[]) => {
            if (selectionMode === "single") {
                const latestId = selectedIds[selectedIds.length - 1]
                setSelectionDraft(draftKey, latestId ? [latestId] : [])
            } else {
                setSelectionDraft(draftKey, selectedIds)
            }
        },
        [draftKey, setSelectionDraft, selectionMode],
    )

    const handleConfirm = useCallback(async () => {
        // Create mode: call onCreateAndLoad callback
        if (isCreateMode && onCreateAndLoad) {
            if (!newTestsetName.trim()) return

            setIsCreating(true)
            try {
                const result = await onCreateAndLoad({
                    testsetName: newTestsetName.trim(),
                    commitMessage: newTestsetCommitMessage.trim(),
                })

                if (result.success) {
                    setIsCreateMode(false)
                    onCancel()
                }
            } finally {
                setIsCreating(false)
            }
            return
        }

        if (isEditMode) {
            // Edit mode: discard draft (never commit) and build payload
            discardSelectionDraft(draftKey)

            let testcases: Record<string, unknown>[] | undefined
            if (!isViewingConnected) {
                testcases = currentSelection.map((id) => {
                    const data = testcase.get.data(id)
                    return data ? {...data} : {id}
                })
            }

            const payload: TestsetSelectionPayload = {
                revisionId: draftKey,
                selectedTestcaseIds: currentSelection,
                importMode: isViewingConnected ? "replace" : "import",
                testcases,
            }

            onConfirm(payload)
        } else {
            // Load mode: commit draft and build payload with metadata
            commitSelectionDraft(draftKey)

            const payload: TestsetSelectionPayload = {
                revisionId: selectedRevisionId ?? "local",
                selectedTestcaseIds: currentSelection,
                testsetName: revisionInfo?.testsetName,
                testsetId: revisionInfo?.testsetId,
                revisionVersion: revisionInfo?.version,
                importMode: "replace",
            }

            onConfirm(payload)
        }
    }, [
        isCreateMode,
        onCreateAndLoad,
        newTestsetName,
        newTestsetCommitMessage,
        isEditMode,
        draftKey,
        currentSelection,
        isViewingConnected,
        discardSelectionDraft,
        commitSelectionDraft,
        selectedRevisionId,
        onConfirm,
        onCancel,
        revisionInfo,
    ])

    const handleCancel = useCallback(() => {
        if (isCreateMode) {
            handleExitCreateMode()
            return
        }
        discardSelectionDraft(draftKey)
        onCancel()
    }, [isCreateMode, handleExitCreateMode, draftKey, discardSelectionDraft, onCancel])

    const isSelectionDisabled = !isEditMode && selectedRevisionId === connectedRevisionId

    // Derive confirm text based on mode
    const confirmText = isEditMode
        ? isViewingConnected
            ? "Update Selection"
            : "Import Selected"
        : "Load Selected"

    const totalCount = paginatedRows.length

    // Build render props for custom preview panel
    const previewPanelProps: PreviewPanelRenderProps = useMemo(
        () => ({
            revisionId: selectedRevisionId,
            selectedIds: currentSelection,
            onSelectionChange: handleSelectionChange,
            selectionMode,
            selectionDisabled: isSelectionDisabled,
            isCreateMode,
            onExitCreateMode: handleExitCreateMode,
        }),
        [
            selectedRevisionId,
            currentSelection,
            handleSelectionChange,
            selectionMode,
            isSelectionDisabled,
            isCreateMode,
            handleExitCreateMode,
        ],
    )

    return (
        <div className="flex flex-col h-full">
            {/* Content area - fills available space */}
            <div className="flex flex-1 overflow-hidden pt-4 min-h-0">
                {/* Left panel - Testset picker + create card */}
                <TestsetSelectionSidebar
                    selectedRevisionId={selectedRevisionId}
                    selectedTestsetId={selectedTestsetId}
                    onSelect={(revisionId, testsetId) => setSelection(revisionId, testsetId)}
                    disabledChildIds={
                        !isEditMode && connectedRevisionId
                            ? new Set([connectedRevisionId])
                            : undefined
                    }
                    {...(!isEditMode && {
                        renderCreateCard,
                        onBuildInUI: handleBuildInUI,
                        isCreateMode,
                        onExitCreateMode: handleExitCreateMode,
                        newTestsetName,
                        onTestsetNameChange: setNewTestsetName,
                        newTestsetCommitMessage,
                        onCommitMessageChange: setNewTestsetCommitMessage,
                    })}
                />

                <Divider orientation="vertical" className="my-0 mx-8 h-auto self-stretch" />

                {/* Right panel - custom or default */}
                {renderPreviewPanel ? (
                    renderPreviewPanel(previewPanelProps)
                ) : (
                    <TestsetSelectionPreview
                        searchTerm={testcaseSearchTerm}
                        onSearchChange={setTestcaseSearchTerm}
                    >
                        <TestcaseTable
                            config={{
                                scopeId: `${mode}-mode-${draftKey}`,
                                revisionId: selectedRevisionId,
                            }}
                            selectable
                            selectedIds={currentSelection}
                            onSelectionChange={handleSelectionChange}
                            multiSelect={selectionMode !== "single"}
                            selectionDisabled={isSelectionDisabled}
                        />
                    </TestsetSelectionPreview>
                )}
            </div>

            {/* Footer - fixed at bottom */}
            <div className="flex-shrink-0 pt-4">
                <SelectionSummary
                    selectedCount={currentSelection.length}
                    totalCount={totalCount}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    confirmDisabled={isCreateMode ? false : currentSelection.length === 0}
                    confirmText={confirmText}
                    disabled={isSelectionDisabled}
                    warningMessage={warningMessage}
                    hasWarning={hasWarning}
                    isCreateMode={isCreateMode}
                    createDisabled={!newTestsetName.trim()}
                    createLoading={isCreating}
                />
            </div>
        </div>
    )
}
