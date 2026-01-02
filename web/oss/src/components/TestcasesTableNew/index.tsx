import {useEffect, useMemo, useState} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useRowHeight} from "@/oss/components/InfiniteVirtualTable"
import useBlockNavigation from "@/oss/hooks/useBlockNavigation"
import useURL from "@/oss/hooks/useURL"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {
    currentRevisionIdAtom,
    revisionsListQueryAtom,
    testsetMetadataAtom,
} from "@/oss/state/entities/testcase/queries"
import {NEW_TESTSET_ID, testset} from "@/oss/state/entities/testset"

import {testcasesSearchTermAtom} from "./atoms/tableStore"
import {TestcaseActions} from "./components/TestcaseActions"
import TestcaseEditDrawer from "./components/TestcaseEditDrawer"
import {TestcaseHeader} from "./components/TestcaseHeader"
import {TestcaseModals} from "./components/TestcaseModals"
import {TestcasesTableShell} from "./components/TestcasesTableShell"
import {useTestcaseActions} from "./hooks/useTestcaseActions"
import {useTestcasesTable} from "./hooks/useTestcasesTable"
import {testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG} from "./state/rowHeight"

/**
 * Props for TestcasesTableNew component
 */
export interface TestcasesTableNewProps {
    /** Display mode: edit allows modifications, view is read-only */
    mode?: "edit" | "view"
}

/**
 * Testcases table - Main component (Refactored)
 *
 * **Architecture:**
 * - TestcasesTableShell: Table rendering with InfiniteVirtualTable
 * - TestcaseHeader: Title, revision selector, metadata
 * - TestcaseActions: Action buttons bar
 * - TestcaseModals: All modal dialogs
 * - TestcaseEditDrawer: Individual testcase editing
 * - useTestcaseActions: All event handlers
 * - useTestcasesTable: State management
 *
 * **Data Flow:**
 * 1. Dataset store fetches revision → all testcases
 * 2. Entity atoms hydrated from revision data
 * 3. Drawer edits → entity atoms
 * 4. Save → collects from entity atoms → creates new revision
 * 5. Refetch → re-hydrates entity atoms
 *
 * @component
 */
export function TestcasesTableNew({mode = "edit"}: TestcasesTableNewProps) {
    const router = useRouter()
    const {testset_id: revisionIdParam} = router.query
    const {projectURL} = useURL()

    // Check if this is a new testset (not yet saved)
    const isNewTestset = revisionIdParam === "new"

    // Global state
    const [searchTerm, setSearchTerm] = useAtom(testcasesSearchTermAtom)
    const rowHeight = useRowHeight(testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG)

    // Metadata from query atoms (not from table hook)
    const metadata = useAtomValue(testsetMetadataAtom)
    const revisionsListQuery = useAtomValue(revisionsListQueryAtom)
    const availableRevisions = revisionsListQuery.data ?? []
    const loadingRevisions = revisionsListQuery.isPending

    // Local UI state
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [editingTestcaseId, setEditingTestcaseId] = useState<string | null>(null)
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false)
    const [isCommitModalOpen, setIsCommitModalOpen] = useState(false)
    const [isAddColumnModalOpen, setIsAddColumnModalOpen] = useState(false)
    const [isIdCopied, setIsIdCopied] = useState(false)
    const [isRevisionSlugCopied, setIsRevisionSlugCopied] = useState(false)

    // Sync current revision ID atom with URL parameter
    const setCurrentRevisionId = useSetAtom(currentRevisionIdAtom)
    useEffect(() => {
        // Handle both string and array cases from router query
        const revisionId = Array.isArray(revisionIdParam) ? revisionIdParam[0] : revisionIdParam
        if (revisionId && typeof revisionId === "string") {
            setCurrentRevisionId(revisionId)
        }
    }, [revisionIdParam, setCurrentRevisionId])

    // Initialize testset draft with name from URL query parameter for new testsets
    const updateTestsetMetadata = useSetAtom(testset.actions.updateMetadata)
    useEffect(() => {
        if (isNewTestset && router.query.name) {
            const nameFromUrl = Array.isArray(router.query.name)
                ? router.query.name[0]
                : router.query.name
            if (nameFromUrl) {
                // Update the testset entity draft (not revision draft)
                // This correctly stores metadata on the testset, not the revision
                updateTestsetMetadata(NEW_TESTSET_ID, {name: decodeURIComponent(nameFromUrl)})
            }
        }
    }, [isNewTestset, router.query.name, updateTestsetMetadata])

    // Main table hook - only manages testcases data
    const table = useTestcasesTable({
        revisionId: revisionIdParam as string,
    })

    // Action handlers hook
    const actions = useTestcaseActions({
        table,
        revisionIdParam,
        mode,
        metadata,
        availableRevisions,
        onOpenCommitModal: () => setIsCommitModalOpen(true),
        onOpenRenameModal: () => setIsRenameModalOpen(true),
        onOpenAddColumnModal: () => setIsAddColumnModalOpen(true),
        onSetEditingTestcaseId: setEditingTestcaseId,
    })

    // Breadcrumbs
    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                testsets: {label: "testsets", href: `${projectURL}/testsets`},
                "testset-detail": {
                    label: metadata?.testsetName ?? "Testset",
                    value: revisionIdParam as string,
                },
            },
            condition: Boolean(projectURL),
        },
        [metadata?.testsetName, router.asPath, projectURL],
    )

    // Block navigation if unsaved changes
    useBlockNavigation(
        table.hasUnsavedChanges,
        {
            title: "Unsaved changes",
            message:
                "You have unsaved changes in your testset. Do you want to save these changes before leaving the page?",
            okText: "Save",
            onOk: async () => {
                await actions.handleSaveTestset()
                return true
            },
            cancelText: "Cancel",
            // For new testsets: "Leave without saving", for existing: "Discard changes"
            thirdButtonText: isNewTestset ? "Leave without saving" : "Discard changes",
            onThirdButton: async () => {
                // For new testsets, just allow navigation (no state to clear)
                // For existing testsets, clear changes to revert to server state
                if (!isNewTestset) {
                    table.clearChanges()
                }
            },
        },
        () => {
            // Skip blocker if we're doing programmatic navigation after save
            if (actions.skipBlockerRef.current) {
                actions.skipBlockerRef.current = false
                return false
            }
            return true
        },
    )

    // Calculate editing row index for drawer navigation
    const editingRowIndex = useMemo(() => {
        return editingTestcaseId ? table.testcaseIds.indexOf(editingTestcaseId) : -1
    }, [editingTestcaseId, table.testcaseIds])

    return (
        <div className="flex flex-col h-full w-full overflow-hidden p-6">
            <TestcasesTableShell
                mode={mode}
                revisionIdParam={revisionIdParam as string}
                table={table}
                rowHeight={rowHeight}
                selectedRowKeys={selectedRowKeys}
                onSelectedRowKeysChange={setSelectedRowKeys}
                onRowClick={actions.handleRowClick}
                onDeleteSelected={() => actions.handleDeleteSelected(selectedRowKeys)}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                onAddColumn={() => setIsAddColumnModalOpen(true)}
                header={
                    <TestcaseHeader
                        testsetName={metadata?.testsetName ?? "Testset"}
                        description={metadata?.description ?? ""}
                        metadata={metadata}
                        availableRevisions={availableRevisions}
                        loadingRevisions={loadingRevisions}
                        isIdCopied={isIdCopied}
                        isRevisionSlugCopied={isRevisionSlugCopied}
                        revisionIdParam={revisionIdParam as string}
                        isNewTestset={isNewTestset}
                        isExporting={actions.isExporting}
                        onCopyId={async () => {
                            await actions.handleCopyId()
                            setIsIdCopied(true)
                            setTimeout(() => setIsIdCopied(false), 2000)
                        }}
                        onCopyRevisionSlug={async () => {
                            await actions.handleCopyRevisionSlug()
                            setIsRevisionSlugCopied(true)
                            setTimeout(() => setIsRevisionSlugCopied(false), 2000)
                        }}
                        onOpenRenameModal={() => setIsRenameModalOpen(true)}
                        onDeleteRevision={actions.handleDeleteRevision}
                        onExport={actions.handleExport}
                        projectURL={projectURL}
                    />
                }
                actions={
                    <TestcaseActions
                        mode={mode}
                        hasUnsavedChanges={table.hasUnsavedChanges}
                        isSaving={table.isSaving}
                        onAddTestcase={actions.handleAddTestcase}
                        onDiscard={actions.handleDiscardChanges}
                        onCommit={() => setIsCommitModalOpen(true)}
                        isNewTestset={isNewTestset}
                    />
                }
            />

            <TestcaseEditDrawer
                testcaseId={editingTestcaseId}
                columns={table.baseColumns}
                open={!!editingTestcaseId}
                onClose={() => setEditingTestcaseId(null)}
                isNewRow={editingTestcaseId?.startsWith("new-") ?? false}
                onPrevious={() =>
                    actions.handlePreviousTestcase(editingTestcaseId, table.testcaseIds)
                }
                onNext={() => actions.handleNextTestcase(editingTestcaseId, table.testcaseIds)}
                hasPrevious={editingRowIndex > 0}
                hasNext={editingRowIndex < table.testcaseIds.length - 1}
                testcaseNumber={editingRowIndex >= 0 ? editingRowIndex + 1 : undefined}
                onOpenCommitModal={() => setIsCommitModalOpen(true)}
                isSavingTestset={table.isSaving}
            />

            <TestcaseModals
                isRenameModalOpen={isRenameModalOpen}
                onRenameCancel={() => setIsRenameModalOpen(false)}
                onRenameConfirm={(name, desc) => {
                    actions.handleRenameConfirm(name, desc, () => setIsRenameModalOpen(false))
                }}
                initialTestsetName={metadata?.testsetName ?? ""}
                initialDescription={metadata?.description ?? ""}
                isCommitModalOpen={isCommitModalOpen}
                onCommitCancel={() => setIsCommitModalOpen(false)}
                onCommit={async (msg) => {
                    await actions.handleCommit(msg)
                    setIsCommitModalOpen(false)
                }}
                changesSummary={isCommitModalOpen ? table.changesSummary : undefined}
                isSaving={table.isSaving}
                currentVersion={metadata?.revisionVersion}
                latestVersion={availableRevisions[0]?.version}
                isAddColumnModalOpen={isAddColumnModalOpen}
                onAddColumnCancel={() => setIsAddColumnModalOpen(false)}
                onAddColumn={(name) => {
                    actions.handleAddColumn(name, () => setIsAddColumnModalOpen(false))
                }}
            />
        </div>
    )
}

export default TestcasesTableNew
