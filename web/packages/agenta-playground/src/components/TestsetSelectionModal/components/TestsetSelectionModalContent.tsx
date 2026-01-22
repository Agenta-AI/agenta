/**
 * TestsetSelectionModalContent Component
 *
 * Contains all data layer logic for the TestsetSelectionModal.
 * This component is only rendered when the modal is open, ensuring
 * that data subscriptions and processing only happen when needed.
 *
 * Supports three modes:
 * - "load": Initial connection to a testset
 * - "edit": Modify selection of an already-connected testset
 * - "save": Save local loadable data as a new testset
 */

import {useCallback, useEffect, useMemo, useState} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule, testcasePaginatedStore} from "@agenta/entities/testcase"
import {TestcaseTable, TestsetPicker} from "@agenta/entities/ui"
import {layoutSizes, ModalContentLayout, PanelFooter, spacingClasses} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {useSaveTestset} from "../hooks/useSaveTestset"
import {useTestsetSelection} from "../hooks/useTestsetSelection"
import type {
    TestsetSelectionModalContentProps,
    TestsetSelectionPayload,
    TestsetImportMode,
} from "../types"

import {SaveTestsetPanel} from "./SaveTestsetPanel"
import {SelectionSummary} from "./SelectionSummary"

// ============================================================================
// SAVE MODE CONTENT
// ============================================================================

interface SaveModeContentProps {
    loadableId: string
    defaultTestsetName?: string
    onSave?: (payload: {testsetId: string; revisionId: string; testsetName: string}) => void
    onCancel: () => void
}

function SaveModeContent({loadableId, defaultTestsetName, onSave, onCancel}: SaveModeContentProps) {
    // Initialize name at entry point (once when save mode opens)
    // Note: This effect is acceptable here because:
    // 1. Modal content only renders when open (remounts on each open)
    // 2. This is one-time initialization, not ongoing sync
    // 3. The alternative (effect atoms) would be overkill for modal-scoped state
    const setName = useSetAtom(loadableController.testset.actions.setName)
    useEffect(() => {
        if (defaultTestsetName) {
            setName(loadableId, defaultTestsetName)
        }
    }, [defaultTestsetName, loadableId, setName])

    const {saveTestset, isSaving} = useSaveTestset({
        loadableId,
        onSuccess: (payload) => {
            onSave?.(payload)
        },
    })

    const handleSaveConfirm = useCallback(
        async (commitMessage?: string) => {
            await saveTestset(commitMessage)
        },
        [saveTestset],
    )

    return (
        <SaveTestsetPanel
            loadableId={loadableId}
            onSave={handleSaveConfirm}
            onCancel={onCancel}
            isSaving={isSaving}
        />
    )
}

// ============================================================================
// EDIT MODE CONTENT
// ============================================================================

interface EditModeContentProps {
    loadableId: string
    connectedRevisionId?: string
    onConfirm: (payload: TestsetSelectionPayload) => void
    onCancel: () => void
}

function EditModeContent({
    loadableId,
    connectedRevisionId,
    onConfirm,
    onCancel,
}: EditModeContentProps) {
    const isLocalTestset = !connectedRevisionId

    // Get ALL rows including hidden ones for Edit modal
    const allRowsIncludingHiddenAtom = useMemo(
        () => loadableController.testset.selectors.allRowsIncludingHidden(loadableId),
        [loadableId],
    )
    const allRowsIncludingHidden = useAtomValue(allRowsIncludingHiddenAtom)

    // Get the loadable controller's displayRowIds (filters out hidden testcases)
    const loadableDisplayRowIdsAtom = useMemo(
        () => loadableController.testset.selectors.displayRowIds(loadableId),
        [loadableId],
    )
    const loadableDisplayRowIds = useAtomValue(loadableDisplayRowIdsAtom)

    // Get ALL testcase IDs (including hidden) for local testset edit mode total count
    const allTestcaseIds = useAtomValue(testcaseMolecule.atoms.displayRowIds)

    // Get columns from loadable controller for local testset edit mode
    const loadableColumnsAtom = useMemo(
        () => loadableController.testset.selectors.columns(loadableId),
        [loadableId],
    )
    const loadableColumns = useAtomValue(loadableColumnsAtom)
    const localColumnKeys = useMemo(() => loadableColumns.map((col) => col.key), [loadableColumns])

    // Selection draft actions
    const initSelectionDraft = useSetAtom(testcaseMolecule.actions.initSelectionDraft)
    const setSelectionDraft = useSetAtom(testcaseMolecule.actions.setSelectionDraft)
    const commitSelectionDraft = useSetAtom(testcaseMolecule.actions.commitSelectionDraft)
    const discardSelectionDraft = useSetAtom(testcaseMolecule.actions.discardSelectionDraft)

    // Get current selection from entity layer
    const draftKey = connectedRevisionId ?? "local"
    const currentSelection = useAtomValue(
        useMemo(() => testcaseMolecule.atoms.currentSelection(draftKey), [draftKey]),
    )

    // Get paginated rows for total count (when not local)
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

    // Initialize draft on mount
    // Note: This effect is acceptable here because modal content remounts on each open,
    // making this effectively a one-time initialization per modal session.
    useEffect(() => {
        initSelectionDraft(draftKey, loadableDisplayRowIds)
    }, [draftKey, initSelectionDraft, loadableDisplayRowIds])

    // Handlers
    const handleSelectionChange = useCallback(
        (selectedIds: string[]) => {
            setSelectionDraft(draftKey, selectedIds)
        },
        [draftKey, setSelectionDraft],
    )

    const handleConfirm = useCallback(() => {
        commitSelectionDraft(draftKey)

        const payload: TestsetSelectionPayload = {
            revisionId: draftKey,
            selectedTestcaseIds: currentSelection,
            importMode: "replace",
        }

        onConfirm(payload)
    }, [draftKey, currentSelection, commitSelectionDraft, onConfirm])

    const handleCancel = useCallback(() => {
        discardSelectionDraft(draftKey)
        onCancel()
    }, [draftKey, discardSelectionDraft, onCancel])

    const totalCount = isLocalTestset ? allTestcaseIds.length : paginatedRows.length

    return (
        <div className="flex flex-col h-full">
            {/* Testcase Table - full width in edit mode */}
            <div className={`flex-1 overflow-auto ${spacingClasses.panel}`}>
                <TestcaseTable
                    config={{
                        scopeId: `edit-mode-${connectedRevisionId ?? "local"}`,
                        revisionId: connectedRevisionId,
                        useLocal: isLocalTestset,
                        localColumnKeys,
                        localRows: allRowsIncludingHidden,
                    }}
                    selectable
                    selectedIds={currentSelection}
                    onSelectionChange={handleSelectionChange}
                />
            </div>

            {/* Footer - Selection Summary (no import mode selector in edit mode) */}
            <PanelFooter align="between">
                <SelectionSummary
                    selectedCount={currentSelection.length}
                    totalCount={totalCount}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    confirmDisabled={currentSelection.length === 0}
                    confirmText="Update Selection"
                    showImportModeSelector={false}
                />
            </PanelFooter>
        </div>
    )
}

// ============================================================================
// LOAD MODE CONTENT
// ============================================================================

interface LoadModeContentProps {
    loadableId: string
    connectedRevisionId?: string
    onConfirm: (payload: TestsetSelectionPayload) => void
    onCancel: () => void
}

function LoadModeContent({
    loadableId,
    connectedRevisionId,
    onConfirm,
    onCancel,
}: LoadModeContentProps) {
    // Testset/revision selection
    const {selectedRevisionId, selectedTestsetId, setSelection, revisionInfo} =
        useTestsetSelection()

    // Import mode state
    const [importMode, setImportMode] = useState<TestsetImportMode>("replace")

    // Check if loadable has existing data (to show import mode selector)
    const loadableRowsAtom = useMemo(
        () => loadableController.testset.selectors.rows(loadableId),
        [loadableId],
    )
    const loadableRows = useAtomValue(loadableRowsAtom)
    const hasExistingData = loadableRows.length > 0

    // Selection draft actions
    const initSelectionDraft = useSetAtom(testcaseMolecule.actions.initSelectionDraft)
    const setSelectionDraft = useSetAtom(testcaseMolecule.actions.setSelectionDraft)
    const commitSelectionDraft = useSetAtom(testcaseMolecule.actions.commitSelectionDraft)
    const discardSelectionDraft = useSetAtom(testcaseMolecule.actions.discardSelectionDraft)

    // Get current selection from entity layer
    const currentSelection = useAtomValue(
        useMemo(
            () => testcaseMolecule.atoms.currentSelection(selectedRevisionId ?? "local"),
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

    // Initialize draft when revision changes
    // Note: This effect handles user-driven revision selection within the modal.
    // It's acceptable because it responds to explicit user actions (selecting a revision),
    // not ongoing state sync. The modal remounts on each open.
    useEffect(() => {
        if (selectedRevisionId) {
            initSelectionDraft(selectedRevisionId)
        }
        // Default import mode based on existing data
        setImportMode(hasExistingData ? "import" : "replace")
    }, [selectedRevisionId, initSelectionDraft, hasExistingData])

    // Handlers
    const handleSelectionChange = useCallback(
        (selectedIds: string[]) => {
            const draftKey = selectedRevisionId ?? "local"
            setSelectionDraft(draftKey, selectedIds)
        },
        [selectedRevisionId, setSelectionDraft],
    )

    const handleConfirm = useCallback(() => {
        const draftKey = selectedRevisionId ?? "local"

        // For import mode, get testcase data
        let testcases: Record<string, unknown>[] | undefined
        if (importMode === "import") {
            testcases = currentSelection.map((id) => {
                const data = testcaseMolecule.get.data(id)
                return data ? {...data} : {id}
            })
        } else {
            commitSelectionDraft(draftKey)
        }

        const payload: TestsetSelectionPayload = {
            revisionId: selectedRevisionId ?? "local",
            selectedTestcaseIds: currentSelection,
            testcases,
            testsetName: revisionInfo?.testsetName,
            testsetId: revisionInfo?.testsetId,
            revisionVersion: revisionInfo?.version,
            importMode,
        }

        onConfirm(payload)
    }, [
        selectedRevisionId,
        currentSelection,
        commitSelectionDraft,
        onConfirm,
        revisionInfo,
        importMode,
    ])

    const handleCancel = useCallback(() => {
        const draftKey = selectedRevisionId ?? "local"
        discardSelectionDraft(draftKey)
        onCancel()
    }, [selectedRevisionId, discardSelectionDraft, onCancel])

    return (
        <ModalContentLayout
            pickerWidth={layoutSizes.sidebarWide}
            picker={
                <TestsetPicker
                    selectedRevisionId={selectedRevisionId}
                    selectedTestsetId={selectedTestsetId}
                    onSelect={setSelection}
                    disabledRevisionIds={
                        connectedRevisionId ? new Set([connectedRevisionId]) : undefined
                    }
                    disabledRevisionTooltip="Already connected"
                />
            }
            content={
                <TestcaseTable
                    config={{
                        scopeId: `load-mode-${selectedRevisionId ?? "none"}`,
                        revisionId: selectedRevisionId,
                    }}
                    selectable
                    selectedIds={currentSelection}
                    onSelectionChange={handleSelectionChange}
                    selectionDisabled={selectedRevisionId === connectedRevisionId}
                />
            }
            footer={
                <SelectionSummary
                    selectedCount={currentSelection.length}
                    totalCount={paginatedRows.length}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    confirmDisabled={currentSelection.length === 0}
                    confirmText={importMode === "import" ? "Import Selected" : "Load Selected"}
                    importMode={importMode}
                    onImportModeChange={setImportMode}
                    showImportModeSelector={hasExistingData}
                    disabled={selectedRevisionId === connectedRevisionId}
                />
            }
        />
    )
}

// ============================================================================
// MAIN CONTENT COMPONENT
// ============================================================================

export function TestsetSelectionModalContent({
    loadableId,
    connectedRevisionId,
    mode,
    onConfirm,
    onSave,
    onCancel,
    defaultTestsetName,
}: TestsetSelectionModalContentProps) {
    if (mode === "save") {
        return (
            <SaveModeContent
                loadableId={loadableId}
                defaultTestsetName={defaultTestsetName}
                onSave={onSave}
                onCancel={onCancel}
            />
        )
    }

    if (mode === "edit") {
        return (
            <EditModeContent
                loadableId={loadableId}
                connectedRevisionId={connectedRevisionId}
                onConfirm={onConfirm}
                onCancel={onCancel}
            />
        )
    }

    // Load mode
    return (
        <LoadModeContent
            loadableId={loadableId}
            connectedRevisionId={connectedRevisionId}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    )
}

export default TestsetSelectionModalContent
