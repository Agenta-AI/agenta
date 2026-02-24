/**
 * EditModeContent Component
 *
 * Handles the "edit" mode of TestsetSelectionModal.
 * Allows modifying selection of an already-connected testset.
 */

import {useCallback, useMemo} from "react"

import {testcase} from "@agenta/entities"
import {loadableController} from "@agenta/entities/loadable"
import {testcasePaginatedStore} from "@agenta/entities/testcase"
import {
    EntityPicker,
    TestcaseTable,
    testsetAdapter,
    type TestsetSelectionResult,
} from "@agenta/entity-ui"
import {layoutSizes, spacingClasses} from "@agenta/ui/styles"
import {Divider} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useTestsetSelection} from "../hooks/useTestsetSelection"
import type {TestsetSelectionPayload} from "../types"

import {SelectionSummary} from "./SelectionSummary"

export interface EditModeContentProps {
    loadableId: string
    connectedRevisionId?: string
    onConfirm: (payload: TestsetSelectionPayload) => void
    onCancel: () => void
}

export function EditModeContent({
    loadableId,
    connectedRevisionId,
    onConfirm,
    onCancel,
}: EditModeContentProps) {
    // Testset/revision selection (starts with connectedRevisionId, if any)
    const {selectedRevisionId, selectedTestsetId, setSelection} = useTestsetSelection(
        connectedRevisionId,
        undefined,
    )

    // Check if viewing the currently connected testset
    const isViewingConnected = (selectedRevisionId ?? undefined) === connectedRevisionId
    // When viewing connected, use local data to show drafts/hidden state
    const useLocal = isViewingConnected
    const _isLocalTestset = !connectedRevisionId && isViewingConnected // Local-only testset (no connected revision yet, just drafts)

    // Get ALL rows including hidden ones for Edit modal
    const allRowsIncludingHiddenAtom = useMemo(
        () => loadableController.selectors.allRowsIncludingHidden(loadableId),
        [loadableId],
    )
    const allRowsIncludingHidden = useAtomValue(allRowsIncludingHiddenAtom)

    // Get the loadable controller's displayRowIds (filters out hidden testcases)
    const loadableDisplayRowIdsAtom = useMemo(
        () => loadableController.selectors.displayRowIds(loadableId),
        [loadableId],
    )
    const _loadableDisplayRowIds = useAtomValue(loadableDisplayRowIdsAtom)

    // Get ALL testcase IDs (including hidden) for local testset edit mode total count
    const allTestcaseIds = useAtomValue(testcase.atoms.displayRowIds)

    // Get columns from loadable controller for local testset edit mode
    const loadableColumnsAtom = useMemo(
        () => loadableController.selectors.columns(loadableId),
        [loadableId],
    )
    const loadableColumns = useAtomValue(loadableColumnsAtom)
    const localColumnKeys = useMemo(() => loadableColumns.map((col) => col.key), [loadableColumns])

    // Selection draft actions
    // Note: We don't use commitSelectionDraft in edit mode - see handleConfirm comment
    const setSelectionDraft = useSetAtom(testcase.actions.setSelectionDraft)
    const discardSelectionDraft = useSetAtom(testcase.actions.discardSelectionDraft)

    // Get current selection from entity layer
    const draftKey = selectedRevisionId ?? "local"
    const currentSelection = useAtomValue(
        useMemo(() => testcase.atoms.currentSelection(draftKey), [draftKey]),
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

    // Handlers
    const handleSelectionChange = useCallback(
        (selectedIds: string[]) => {
            setSelectionDraft(draftKey, selectedIds)
        },
        [draftKey, setSelectionDraft],
    )

    const handleConfirm = useCallback(() => {
        // NOTE: Do NOT call commitSelectionDraft here for connected revisions!
        // We only need to discard the draft after getting the current selection.
        discardSelectionDraft(draftKey)

        // For import mode (selected another testset), we need the actual testcase data
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
    }, [draftKey, currentSelection, discardSelectionDraft, isViewingConnected, onConfirm])

    const handleCancel = useCallback(() => {
        discardSelectionDraft(draftKey)
        onCancel()
    }, [draftKey, discardSelectionDraft, onCancel])

    const totalCount = useLocal ? allTestcaseIds.length : paginatedRows.length

    return (
        <div className="flex flex-col h-full">
            <div className="flex flex-1 overflow-hidden" style={{minHeight: 0}}>
                {/* Left panel - Testset picker (fixed width) */}
                <div
                    className={`flex flex-col overflow-auto ${spacingClasses.panel}`}
                    style={{
                        width: layoutSizes.sidebarWide,
                        flexShrink: 0,
                    }}
                >
                    <EntityPicker<TestsetSelectionResult>
                        variant="list-popover"
                        adapter={testsetAdapter}
                        onSelect={(selection) =>
                            setSelection(
                                selection.metadata.revisionId,
                                selection.metadata.testsetId,
                            )
                        }
                        selectedParentId={selectedTestsetId}
                        selectedChildId={selectedRevisionId}
                        showSearch
                        emptyMessage="No testsets found"
                        popoverPlacement="rightTop"
                        autoSelectLatest
                        selectLatestOnParentClick
                    />
                </div>

                <Divider orientation="vertical" className="m-0 h-auto self-stretch" />

                {/* Right panel - Testcase table (fills remaining width and height) */}
                <div
                    className={`flex flex-col flex-1 overflow-hidden ${spacingClasses.panel}`}
                    style={{minWidth: 0, minHeight: 0}}
                >
                    <TestcaseTable
                        config={{
                            scopeId: `edit-mode-${draftKey}`,
                            revisionId: selectedRevisionId,
                            useLocal,
                            localColumnKeys,
                            localRows: useLocal ? allRowsIncludingHidden : undefined,
                        }}
                        selectable
                        selectedIds={currentSelection}
                        onSelectionChange={handleSelectionChange}
                    />
                </div>
            </div>

            {/* Footer - fixed at bottom */}
            <div className={`border-t flex-shrink-0 ${spacingClasses.panel}`}>
                <SelectionSummary
                    selectedCount={currentSelection.length}
                    totalCount={totalCount}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    confirmDisabled={currentSelection.length === 0}
                    confirmText={isViewingConnected ? "Update Selection" : "Import Selected"}
                />
            </div>
        </div>
    )
}
