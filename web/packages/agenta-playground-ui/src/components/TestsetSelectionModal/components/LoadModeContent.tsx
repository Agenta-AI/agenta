/**
 * LoadModeContent Component
 *
 * Handles the "load" mode of TestsetSelectionModal.
 * Allows initial connection to a testset with import/replace options.
 */

import {useCallback, useMemo, useState} from "react"

import {testcase} from "@agenta/entities"
import {testcasePaginatedStore} from "@agenta/entities/testcase"
import {
    EntityPicker,
    TestcaseTable,
    testsetAdapter,
    type TestsetSelectionResult,
} from "@agenta/entity-ui"
import {layoutSizes, spacingClasses} from "@agenta/ui/styles"
import {InboxOutlined} from "@ant-design/icons"
import {Table} from "@phosphor-icons/react"
import {Button, Divider, Input, Typography, Upload} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useTestsetSelection} from "../hooks/useTestsetSelection"
import type {TestsetSelectionPayload} from "../types"

import {SelectionSummary} from "./SelectionSummary"

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
                {/* Left panel - Testset picker + create card (fixed width) */}
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
                        sectionLabel="Test sets"
                        emptyMessage="No testsets found"
                        popoverPlacement="rightTop"
                        autoSelectLatest
                        selectLatestOnParentClick
                        maxHeight={220}
                        disabledChildIds={
                            connectedRevisionId ? new Set([connectedRevisionId]) : undefined
                        }
                        disabledChildTooltip="Already connected"
                    />

                    {/* "Create a new testset" card — decorative for now.
                     * TODO: In-place testset editor (future work):
                     * - "Drop CSV/JSON" dragger should trigger file upload + create new testset
                     *   then auto-select it (similar to CreateTestsetCard.handleFileChange flow).
                     * - "Build in UI" button should enter an in-place edit mode:
                     *   set a local "isCreatingNew" flag, switch the right panel to an editable
                     *   TestcasesTableShell (mode="edit"), name input at top, and on confirm
                     *   call saveNewTestset + onConfirm (mirroring the old CreateTestsetCard flow).
                     */}
                    <div className="mt-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-4 flex flex-col gap-3">
                        <Typography.Text className="font-medium text-sm">
                            Create a new testset
                        </Typography.Text>
                        <Upload.Dragger
                            accept=".csv,.json"
                            beforeUpload={() => false}
                            showUploadList={false}
                            disabled
                            className="!bg-white !border-gray-200 !rounded-xl"
                        >
                            <div className="flex flex-col items-center justify-center gap-2 py-2">
                                <InboxOutlined className="text-gray-400 text-xl" />
                                <Typography.Text className="text-sm">
                                    Drop CSV/JSON here or click to browse
                                </Typography.Text>
                            </div>
                        </Upload.Dragger>

                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-400">
                            <span className="h-px flex-1 bg-gray-200" />
                            <span>or</span>
                            <span className="h-px flex-1 bg-gray-200" />
                        </div>

                        <Button
                            type="primary"
                            block
                            disabled
                            icon={<Table size={16} weight="regular" />}
                        >
                            Build in UI
                        </Button>
                    </div>
                </div>

                <Divider orientation="vertical" className="m-0 h-auto self-stretch" />

                {/* Right panel - Testcase search + table (fills remaining width and height) */}
                <div
                    className={`flex flex-col flex-1 overflow-hidden ${spacingClasses.panel}`}
                    style={{minWidth: 0, minHeight: 0}}
                >
                    {/* Testcase search bar — visual only for now.
                     * TODO: Wire to TestcaseTable search filter when EntityTable exposes a
                     * searchTerm prop for client-side row filtering (similar to
                     * TestcasesTableShell.onSearchChange in the legacy LoadTestsetModal). */}
                    <Input.Search
                        placeholder="Search testcases..."
                        value={testcaseSearchTerm}
                        onChange={(e) => setTestcaseSearchTerm(e.target.value)}
                        className="mb-3 flex-shrink-0"
                    />

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
                    confirmText="Load Selected"
                    disabled={selectedRevisionId === connectedRevisionId}
                />
            </div>
        </div>
    )
}
