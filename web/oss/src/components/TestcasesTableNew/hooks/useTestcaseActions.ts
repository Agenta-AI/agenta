import {useCallback, useRef} from "react"

import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

import AlertPopup from "../../AlertPopup/AlertPopup"
import {message} from "../../AppMessageContext"
import type {TestcaseTableRow} from "../atoms/tableStore"

import type {UseTestcasesTableResult} from "./types"

/**
 * Configuration for useTestcaseActions hook
 */
export interface UseTestcaseActionsConfig {
    table: UseTestcasesTableResult
    revisionIdParam: string | string[] | undefined
    mode: "edit" | "view"
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

    // Revision actions
    handleDeleteRevision: () => Promise<void>
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
        onOpenCommitModal,
        onOpenRenameModal: _onOpenRenameModal,
        onSetEditingTestcaseId,
    } = config

    const router = useRouter()
    const {projectURL} = useURL()

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

            try {
                const newRevisionId = await table.saveTestset(commitMessage)
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
        [table, router, projectURL, mode],
    )

    const handleDiscardChanges = useCallback(() => {
        if (mode === "view") return

        AlertPopup({
            title: "Discard changes?",
            message: "Are you sure you want to discard all unsaved changes?",
            okText: "Discard",
            okButtonProps: {danger: true},
            onOk: () => {
                table.clearChanges()
                message.success("Changes discarded")
            },
        })
    }, [table, mode])

    // ========================================================================
    // METADATA ACTIONS
    // ========================================================================

    const handleRenameConfirm = useCallback(
        (editModalName: string, editModalDescription: string, onClose: () => void) => {
            if (mode === "view") return
            table.setTestsetName(editModalName)
            table.setDescription(editModalDescription)
            onClose()
        },
        [table, mode],
    )

    const handleCopyId = useCallback(async () => {
        if (revisionIdParam) {
            await copyToClipboard(revisionIdParam as string)
            message.success("Revision ID copied to clipboard")
        }
    }, [revisionIdParam])

    // ========================================================================
    // REVISION ACTIONS
    // ========================================================================

    const handleDeleteRevision = useCallback(async () => {
        if (!revisionIdParam) return

        // Check if this is the only valid revision
        const validRevisions = table.availableRevisions.filter((r) => r.version > 0)
        const isOnlyRevision = validRevisions.length <= 1

        if (isOnlyRevision) {
            message.error("Cannot delete the only revision")
            return
        }

        AlertPopup({
            title: "Delete Revision",
            message: `Are you sure you want to delete revision v${table.metadata?.revisionVersion}? This action cannot be undone.`,
            okText: "Delete",
            okButtonProps: {danger: true},
            onOk: async () => {
                try {
                    const {archiveTestsetRevision} = await import("@/oss/services/testsets/api")
                    await archiveTestsetRevision(revisionIdParam as string)
                    message.success("Revision deleted successfully")

                    // Navigate to the latest revision
                    const latestRevision = table.availableRevisions
                        .filter((r) => r.id !== revisionIdParam)
                        .sort((a, b) => b.version - a.version)[0]

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
    }, [revisionIdParam, table, router, projectURL])

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
        handleDeleteRevision,
    }
}
