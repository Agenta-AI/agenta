/**
 * LoadModeContent Component
 *
 * Handles the "load" mode of TestsetSelectionModal.
 * Allows initial connection to a testset with import/replace options.
 * Also handles "create" mode (Build in UI) with name/commit inputs
 * and a Create & Load footer button.
 */

import {useCallback, useMemo, useState} from "react"

import {testcase} from "@agenta/entities"
import {testcasePaginatedStore} from "@agenta/entities/testcase"
import {TestcaseTable} from "@agenta/entity-ui"
import {Divider} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useTestsetSelection} from "../hooks/useTestsetSelection"
import type {PreviewPanelRenderProps, TestsetSelectionPayload} from "../types"

import {SelectionSummary} from "./SelectionSummary"
import {TestsetSelectionPreview} from "./TestsetSelectionPreview"
import {TestsetSelectionSidebar} from "./TestsetSelectionSidebar"

export interface LoadModeContentProps {
    loadableId: string
    connectedRevisionId?: string
    onConfirm: (payload: TestsetSelectionPayload) => void
    onCancel: () => void
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
    connectedRevisionId,
    onConfirm,
    onCancel,
    selectionMode = "multiple",
    renderCreateCard,
    renderPreviewPanel,
    warningMessage,
    hasWarning,
    onCreateAndLoad,
}: LoadModeContentProps) {
    // Testset/revision selection
    const {selectedRevisionId, selectedTestsetId, setSelection, revisionInfo} =
        useTestsetSelection()

    // Testcase search term (used by default preview panel)
    const [testcaseSearchTerm, setTestcaseSearchTerm] = useState("")

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
        // Save current selection before entering create mode
        setPreviousSelection({
            revisionId: selectedRevisionId,
            testsetId: selectedTestsetId,
        })
        setIsCreateMode(true)
        setNewTestsetName("")
        setNewTestsetCommitMessage("")
        // Set revision to "new" so the preview panel initializes an empty editable table
        setSelection("new", "")
    }, [setSelection, selectedRevisionId, selectedTestsetId])

    const handleExitCreateMode = useCallback(() => {
        setIsCreateMode(false)
        setNewTestsetName("")
        setNewTestsetCommitMessage("")
        // Restore previous selection
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

    // Get current selection from entity layer
    const currentSelection = useAtomValue(
        useMemo(
            () => testcase.atoms.currentSelection(selectedRevisionId ?? "local"),
            [selectedRevisionId],
        ),
    )

    // Get paginated rows
    const paginatedParams = useMemo(
        () => ({
            scopeId: `testcase-selection-${selectedRevisionId ?? "local"}`,
            pageSize: 100,
        }),
        [selectedRevisionId],
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
            const draftKey = selectedRevisionId ?? "local"
            if (selectionMode === "single") {
                const latestId = selectedIds[selectedIds.length - 1]
                setSelectionDraft(draftKey, latestId ? [latestId] : [])
            } else {
                setSelectionDraft(draftKey, selectedIds)
            }
        },
        [selectedRevisionId, setSelectionDraft, selectionMode],
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
                    onCancel() // Close the modal after successful creation
                }
            } finally {
                setIsCreating(false)
            }
            return
        }

        // Normal load flow
        const draftKey = selectedRevisionId ?? "local"
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
    }, [
        isCreateMode,
        onCreateAndLoad,
        newTestsetName,
        newTestsetCommitMessage,
        selectedRevisionId,
        currentSelection,
        commitSelectionDraft,
        onConfirm,
        onCancel,
        revisionInfo,
    ])

    const handleCancel = useCallback(() => {
        if (isCreateMode) {
            handleExitCreateMode()
            return
        }
        const draftKey = selectedRevisionId ?? "local"
        discardSelectionDraft(draftKey)
        onCancel()
    }, [isCreateMode, handleExitCreateMode, selectedRevisionId, discardSelectionDraft, onCancel])

    const isSelectionDisabled = selectedRevisionId === connectedRevisionId

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
                        connectedRevisionId ? new Set([connectedRevisionId]) : undefined
                    }
                    renderCreateCard={renderCreateCard}
                    onBuildInUI={handleBuildInUI}
                    isCreateMode={isCreateMode}
                    onExitCreateMode={handleExitCreateMode}
                    newTestsetName={newTestsetName}
                    onTestsetNameChange={setNewTestsetName}
                    newTestsetCommitMessage={newTestsetCommitMessage}
                    onCommitMessageChange={setNewTestsetCommitMessage}
                />

                <Divider type="vertical" className="my-0 mx-8 h-auto self-stretch" />

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
                                scopeId: `load-mode-${selectedRevisionId ?? "none"}`,
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
                    totalCount={paginatedRows.length}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    confirmDisabled={isCreateMode ? false : currentSelection.length === 0}
                    confirmText="Load Selected"
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
