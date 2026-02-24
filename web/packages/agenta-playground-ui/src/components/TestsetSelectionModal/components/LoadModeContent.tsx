/**
 * LoadModeContent Component
 *
 * Handles the "load" mode of TestsetSelectionModal.
 * Allows initial connection to a testset with import/replace options.
 */

import {useCallback, useMemo, useState} from "react"

import {testcase} from "@agenta/entities"
import {testcasePaginatedStore} from "@agenta/entities/testcase"
import {TestcaseTable} from "@agenta/entity-ui"
import {spacingClasses} from "@agenta/ui/styles"
import {Divider} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useTestsetSelection} from "../hooks/useTestsetSelection"
import type {TestsetSelectionPayload} from "../types"

import {SelectionSummary} from "./SelectionSummary"
import {TestsetSelectionPreview} from "./TestsetSelectionPreview"
import {TestsetSelectionSidebar} from "./TestsetSelectionSidebar"

export interface LoadModeContentProps {
    loadableId: string
    connectedRevisionId?: string
    onConfirm: (payload: TestsetSelectionPayload) => void
    onCancel: () => void
}

export function LoadModeContent({connectedRevisionId, onConfirm, onCancel}: LoadModeContentProps) {
    // Testset/revision selection
    const {selectedRevisionId, selectedTestsetId, setSelection, revisionInfo} =
        useTestsetSelection()

    // Testcase search term (visual only for now)
    // TODO: Wire to TestcaseTable search filter.
    // When functional, pass searchTerm to TestcaseTable (requires TestcaseTable/EntityTable
    // to expose a searchTerm prop that filters rows client-side, similar to
    // TestcasesTableShell.searchTerm in the legacy LoadTestsetModal).
    const [testcaseSearchTerm, setTestcaseSearchTerm] = useState("")

    // Selection draft actions
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
    }, [selectedRevisionId, currentSelection, commitSelectionDraft, onConfirm, revisionInfo])

    const handleCancel = useCallback(() => {
        const draftKey = selectedRevisionId ?? "local"
        discardSelectionDraft(draftKey)
        onCancel()
    }, [selectedRevisionId, discardSelectionDraft, onCancel])

    return (
        <div className="flex flex-col" style={{height: "100%"}}>
            {/* Content area - fills available space */}
            <div className="flex flex-1 overflow-hidden" style={{minHeight: 0}}>
                {/* Left panel - Testset picker + create card */}
                <TestsetSelectionSidebar
                    selectedRevisionId={selectedRevisionId}
                    selectedTestsetId={selectedTestsetId}
                    onSelect={(revisionId, testsetId) => setSelection(revisionId, testsetId)}
                    disabledChildIds={
                        connectedRevisionId ? new Set([connectedRevisionId]) : undefined
                    }
                    showCreateCard={true}
                />

                <Divider type="vertical" className="m-0 h-auto self-stretch" />

                {/* Right panel - Testcase search + table */}
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
                        selectionDisabled={selectedRevisionId === connectedRevisionId}
                    />
                </TestsetSelectionPreview>
            </div>

            {/* Footer - fixed at bottom */}
            <div className={`border-t flex-shrink-0 ${spacingClasses.panel}`}>
                <SelectionSummary
                    selectedCount={currentSelection.length}
                    totalCount={paginatedRows.length}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    confirmDisabled={currentSelection.length === 0}
                    confirmText="Load Selected"
                    disabled={selectedRevisionId === connectedRevisionId}
                />
            </div>
        </div>
    )
}
