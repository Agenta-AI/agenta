import {useCallback, useRef} from "react"

import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {downloadRevision, updateTestsetMetadata} from "@/oss/services/testsets/api"
import type {ExportFileType} from "@/oss/services/testsets/api"
import type {TestsetMetadata} from "@/oss/state/entities/testcase/queries"
import {
    revision,
    invalidateTestsetCache,
    invalidateTestsetsListCache,
    invalidateRevisionsListCache,
} from "@/oss/state/entities/testset"

import AlertPopup from "../../AlertPopup/AlertPopup"
import {message} from "../../AppMessageContext"
import type {TestcaseTableRow} from "../atoms/tableStore"

import type {RevisionListItem, UseTestcasesTableResult} from "./types"

/**
 * Configuration for useTestcaseActions hook
 */
export interface UseTestcaseActionsConfig {
    table: UseTestcasesTableResult
    revisionIdParam: string | string[] | undefined
    mode: "edit" | "view"
    metadata: TestsetMetadata | null
    availableRevisions: RevisionListItem[]
    onOpenCommitModal: () => void
    onOpenRenameModal: () => void
    onOpenAddColumnModal: () => void
    onSetEditingTestcaseId: (id: string | null) => void
}

/**
 * Result of useTestcaseActions hook
 */
export interface UseTestcaseActionsResult {
    // Navigation blocker
    skipBlockerRef: React.MutableRefObject<boolean>

    // Test case actions
    handleAddTestcase: () => void
    handleDeleteSelected: (selectedRowKeys: React.Key[]) => void
    handleRowClick: (record: TestcaseTableRow) => void
    handlePreviousTestcase: (editingTestcaseId: string | null, testcaseIds: string[]) => void
    handleNextTestcase: (editingTestcaseId: string | null, testcaseIds: string[]) => void

    // Column actions
    handleAddColumn: (newColumnName: string, onClose: () => void) => void
    handleAppendFromFile: (file: File) => Promise<void>

    // Save/commit actions
    handleSaveTestset: () => Promise<void>
    handleCommit: (commitMessage: string) => Promise<void>
    handleDiscardChanges: () => void

    // Metadata actions
    handleRenameConfirm: (
        editModalName: string,
        editModalDescription: string,
        onClose: () => void,
    ) => void
    handleCopyId: () => Promise<void>
    handleCopyRevisionSlug: () => Promise<void>

    // Revision actions
    handleDeleteRevision: () => Promise<void>

    // Export actions
    handleExport: (fileType: ExportFileType) => Promise<void>
}

/**
 * Hook that provides all action handlers for the testcases table
 * Extracted from the main component to reduce complexity
 */
export function useTestcaseActions(config: UseTestcaseActionsConfig): UseTestcaseActionsResult {
    const {
        table,
        revisionIdParam,
        mode,
        metadata,
        availableRevisions,
        onOpenCommitModal,
        onOpenRenameModal: _onOpenRenameModal,
        onSetEditingTestcaseId,
    } = config

    const router = useRouter()
    const {projectURL} = useURL()

    // Action for clearing revision draft on discard
    const discardRevisionDraft = useSetAtom(revision.actions.discardDraft)

    // Track programmatic navigation after save to skip blocker
    const skipBlockerRef = useRef(false)

    // ========================================================================
    // TESTCASE ACTIONS
    // ========================================================================

    const handleAddTestcase = useCallback(() => {
        if (mode === "view") return
        const newRow = table.addTestcase()
        onSetEditingTestcaseId(newRow.key as string)
    }, [table, mode, onSetEditingTestcaseId])

    const handleDeleteSelected = useCallback(
        (selectedRowKeys: React.Key[]) => {
            if (mode === "view" || selectedRowKeys.length === 0) return
            table.deleteTestcases(selectedRowKeys.map(String))
            message.success(`Deleted ${selectedRowKeys.length} testcase(s). Save to apply changes.`)
        },
        [table, mode],
    )

    const handleRowClick = useCallback(
        (record: TestcaseTableRow) => {
            if (mode === "view" || record.__isSkeleton) return
            if (record.id) {
                onSetEditingTestcaseId(record.id)
            }
        },
        [mode, onSetEditingTestcaseId],
    )

    const handlePreviousTestcase = useCallback(
        (editingTestcaseId: string | null, testcaseIds: string[]) => {
            if (!editingTestcaseId) return
            const currentIndex = testcaseIds.indexOf(editingTestcaseId)
            if (currentIndex > 0) {
                onSetEditingTestcaseId(testcaseIds[currentIndex - 1])
            }
        },
        [onSetEditingTestcaseId],
    )

    const handleNextTestcase = useCallback(
        (editingTestcaseId: string | null, testcaseIds: string[]) => {
            if (!editingTestcaseId) return
            const currentIndex = testcaseIds.indexOf(editingTestcaseId)
            if (currentIndex < testcaseIds.length - 1) {
                onSetEditingTestcaseId(testcaseIds[currentIndex + 1])
            }
        },
        [onSetEditingTestcaseId],
    )

    // ========================================================================
    // COLUMN ACTIONS
    // ========================================================================

    const handleAddColumn = useCallback(
        (newColumnName: string, onClose: () => void) => {
            if (mode === "view") return
            const trimmedName = newColumnName.trim()
            if (!trimmedName) {
                message.error("Column name cannot be empty")
                return
            }
            if (table.columns.some((col) => col.name === trimmedName)) {
                message.error(`Column "${trimmedName}" already exists`)
                return
            }
            table.addColumn(trimmedName)
            onClose()
            message.success(`Added column "${trimmedName}". Save to apply changes.`)
        },
        [table, mode],
    )

    const handleAppendFromFile = useCallback(
        async (file: File) => {
            if (mode === "view") return

            try {
                const text = await file.text()
                const lines = text.split("\n").filter((line) => line.trim())
                if (lines.length === 0) {
                    message.error("File is empty")
                    return
                }

                // Parse CSV header
                const headerLine = lines[0]
                const headers = headerLine.split(",").map((h) => h.trim())

                // Parse data rows
                const dataRows: Record<string, unknown>[] = []
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(",").map((v) => v.trim())
                    const row: Record<string, unknown> = {}
                    headers.forEach((header, idx) => {
                        row[header] = values[idx] || ""
                    })
                    dataRows.push(row)
                }

                const count = table.appendTestcases(dataRows)
                message.success(`Appended ${count} testcases from file. Save to apply changes.`)
            } catch (error) {
                console.error("Failed to parse file:", error)
                message.error("Failed to parse file. Please ensure it's a valid CSV.")
            }
        },
        [table, mode],
    )

    // ========================================================================
    // SAVE/COMMIT ACTIONS
    // ========================================================================

    const handleSaveTestset = useCallback(async () => {
        if (mode === "view") return
        onOpenCommitModal()
    }, [mode, onOpenCommitModal])

    const handleCommit = useCallback(
        async (commitMessage: string) => {
            if (mode === "view") return

            // Check if this is a new testset
            const isNewTestset = revisionIdParam === "new"

            try {
                const newRevisionId = await table.saveTestset({
                    commitMessage,
                    // For new testsets, pass the name from metadata (set from URL query param)
                    testsetName: isNewTestset ? metadata?.testsetName : undefined,
                })
                if (newRevisionId) {
                    message.success("Changes saved successfully!")
                    skipBlockerRef.current = true // Skip nav blocker for programmatic navigation
                    // Navigate to the new revision
                    router.push(`${projectURL}/testsets/${newRevisionId}`, undefined, {
                        shallow: false,
                    })
                }
            } catch (error) {
                console.error("Failed to save testset:", error)
                message.error("Failed to save changes")
            }
        },
        [table, router, projectURL, mode, revisionIdParam, metadata?.testsetName],
    )

    const handleDiscardChanges = useCallback(() => {
        if (mode === "view") return

        AlertPopup({
            title: "Discard changes?",
            message: "Are you sure you want to discard all unsaved changes?",
            okText: "Discard",
            okButtonProps: {danger: true},
            onOk: () => {
                // Clear testcase changes
                table.clearChanges()

                // Clear revision draft (name/description changes)
                if (revisionIdParam) {
                    const revisionId = Array.isArray(revisionIdParam)
                        ? revisionIdParam[0]
                        : revisionIdParam
                    if (revisionId) {
                        discardRevisionDraft(revisionId)
                    }
                }

                message.success("Changes discarded")
            },
        })
    }, [table, mode, revisionIdParam, discardRevisionDraft])

    // ========================================================================
    // METADATA ACTIONS
    // ========================================================================

    const handleRenameConfirm = useCallback(
        async (editModalName: string, editModalDescription: string, onClose: () => void) => {
            if (mode === "view") return

            const testsetId = metadata?.testsetId
            if (!testsetId) {
                message.error("Testset not found")
                return
            }

            try {
                // Update testset metadata directly (not via commit flow)
                await updateTestsetMetadata(testsetId, {
                    name: editModalName,
                    description: editModalDescription,
                })
                message.success("Testset details updated")
                onClose()
                // Invalidate caches to refresh the UI
                invalidateTestsetCache(testsetId)
                invalidateTestsetsListCache()
            } catch (error) {
                console.error("Failed to update testset details:", error)
                message.error("Failed to update testset details")
            }
        },
        [mode, metadata?.testsetId],
    )

    const handleCopyId = useCallback(async () => {
        if (revisionIdParam) {
            await copyToClipboard(revisionIdParam as string)
            message.success("Revision ID copied to clipboard")
        }
    }, [revisionIdParam])

    const handleCopyRevisionSlug = useCallback(async () => {
        const revisionSlug = metadata?.revisionSlug
        if (revisionSlug) {
            await copyToClipboard(revisionSlug)
            message.success("Revision slug copied to clipboard")
        }
    }, [metadata?.revisionSlug])

    // ========================================================================
    // REVISION ACTIONS
    // ========================================================================

    const handleDeleteRevision = useCallback(async () => {
        if (!revisionIdParam) return

        // Check if this is the only valid revision
        const validRevisions = availableRevisions.filter((r: RevisionListItem) => r.version > 0)
        const isOnlyRevision = validRevisions.length <= 1

        if (isOnlyRevision) {
            message.error("Cannot delete the only revision")
            return
        }

        AlertPopup({
            title: "Delete Revision",
            message: `Are you sure you want to delete revision v${metadata?.revisionVersion}? This action cannot be undone.`,
            okText: "Delete",
            okButtonProps: {danger: true},
            onOk: async () => {
                try {
                    const {archiveTestsetRevision} = await import("@/oss/services/testsets/api")
                    await archiveTestsetRevision(revisionIdParam as string)
                    message.success("Revision deleted successfully")

                    // Invalidate caches so revisions list and testset data are refreshed
                    if (metadata?.testsetId) {
                        invalidateRevisionsListCache(metadata.testsetId)
                        invalidateTestsetCache(metadata.testsetId)
                    }
                    invalidateTestsetsListCache()

                    // Navigate to the latest revision
                    const latestRevision = availableRevisions
                        .filter((r: RevisionListItem) => r.id !== revisionIdParam)
                        .sort(
                            (a: RevisionListItem, b: RevisionListItem) => b.version - a.version,
                        )[0]

                    if (latestRevision) {
                        router.push(`${projectURL}/testsets/${latestRevision.id}`, undefined, {
                            shallow: false,
                        })
                    } else {
                        router.push(`${projectURL}/testsets`)
                    }
                } catch (error) {
                    console.error("Failed to delete revision:", error)
                    message.error("Failed to delete revision")
                }
            },
        })
    }, [revisionIdParam, metadata, availableRevisions, router, projectURL])

    // ========================================================================
    // EXPORT ACTIONS
    // ========================================================================

    const handleExport = useCallback(
        async (fileType: ExportFileType) => {
            if (!revisionIdParam) {
                message.error("No revision to export")
                return
            }

            try {
                const testsetName = metadata?.testsetName || "testset"
                const version = metadata?.revisionVersion ?? "unknown"
                const filename = `${testsetName}_v${version}.${fileType}`
                await downloadRevision(revisionIdParam as string, fileType, filename)
                message.success(`Exported as ${fileType.toUpperCase()}`)
            } catch (error) {
                console.error("Failed to export:", error)
                message.error(`Failed to export as ${fileType.toUpperCase()}`)
            }
        },
        [revisionIdParam, metadata?.testsetName, metadata?.revisionVersion],
    )

    return {
        skipBlockerRef,
        handleAddTestcase,
        handleDeleteSelected,
        handleRowClick,
        handlePreviousTestcase,
        handleNextTestcase,
        handleAddColumn,
        handleAppendFromFile,
        handleSaveTestset,
        handleCommit,
        handleDiscardChanges,
        handleRenameConfirm,
        handleCopyId,
        handleCopyRevisionSlug,
        handleDeleteRevision,
        handleExport,
    }
}
