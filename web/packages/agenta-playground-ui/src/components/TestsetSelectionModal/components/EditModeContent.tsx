/**
 * EditModeContent Component
 *
 * Handles the "edit" mode of TestsetSelectionModal.
 * Allows modifying selection of an already-connected testset.
 */

import {useCallback, useEffect, useMemo} from "react"

import {testcase} from "@agenta/entities"
import {loadableController} from "@agenta/entities/loadable"
import {testcasePaginatedStore} from "@agenta/entities/testcase"
import {TestcaseTable} from "@agenta/entity-ui"
import {PanelFooter} from "@agenta/ui/components/presentational"
import {spacingClasses} from "@agenta/ui/styles"
import {useAtomValue, useSetAtom} from "jotai"

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
    const isLocalTestset = !connectedRevisionId

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
    const loadableDisplayRowIds = useAtomValue(loadableDisplayRowIdsAtom)

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
    const initSelectionDraft = useSetAtom(testcase.actions.initSelectionDraft)
    const setSelectionDraft = useSetAtom(testcase.actions.setSelectionDraft)
    const discardSelectionDraft = useSetAtom(testcase.actions.discardSelectionDraft)

    // Get current selection from entity layer
    const draftKey = connectedRevisionId ?? "local"
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
        // NOTE: Do NOT call commitSelectionDraft here!
        // commitSelectionDraft sets testcaseIdsAtom directly, which causes duplicates
        // for local testsets (IDs end up in both newEntityIdsAtom AND testcaseIdsAtom).
        // The updateTestcaseSelection action (called by onConfirm) handles the update
        // correctly via hiddenTestcaseIds for local testsets.
        // We only need to discard the draft after getting the current selection.
        discardSelectionDraft(draftKey)

        const payload: TestsetSelectionPayload = {
            revisionId: draftKey,
            selectedTestcaseIds: currentSelection,
            importMode: "replace",
        }

        onConfirm(payload)
    }, [draftKey, currentSelection, discardSelectionDraft, onConfirm])

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
