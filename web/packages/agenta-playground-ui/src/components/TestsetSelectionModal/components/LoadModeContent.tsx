/**
 * LoadModeContent Component
 *
 * Handles the "load" mode of TestsetSelectionModal.
 * Allows initial connection to a testset with import/replace options.
 */

import {useCallback, useEffect, useMemo, useState} from "react"

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
import type {TestsetImportMode, TestsetSelectionPayload} from "../types"

import {SelectionSummary} from "./SelectionSummary"

export interface LoadModeContentProps {
    loadableId: string
    connectedRevisionId?: string
    onConfirm: (payload: TestsetSelectionPayload) => void
    onCancel: () => void
}

export function LoadModeContent({
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
        () => loadableController.selectors.rows(loadableId),
        [loadableId],
    )
    const loadableRows = useAtomValue(loadableRowsAtom)
    const hasExistingData = loadableRows.length > 0

    // Selection draft actions
    const initSelectionDraft = useSetAtom(testcase.actions.initSelectionDraft)
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
                const data = testcase.get.data(id)
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
        <div className="flex flex-col" style={{height: "100%"}}>
            {/* Content area - fills available space */}
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
                        disabledChildIds={
                            connectedRevisionId ? new Set([connectedRevisionId]) : undefined
                        }
                        disabledChildTooltip="Already connected"
                    />
                </div>

                <Divider type="vertical" className="m-0 h-auto self-stretch" />

                {/* Right panel - Testcase table (fills remaining width and height) */}
                <div
                    className={`flex flex-col flex-1 overflow-hidden ${spacingClasses.panel}`}
                    style={{minWidth: 0, minHeight: 0}}
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
                </div>
            </div>

            {/* Footer - fixed at bottom */}
            <div className={`border-t flex-shrink-0 ${spacingClasses.panel}`}>
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
            </div>
        </div>
    )
}
