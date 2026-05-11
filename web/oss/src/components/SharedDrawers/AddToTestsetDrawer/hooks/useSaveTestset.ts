import {useCallback} from "react"

import {
    invalidateRevisionsListCache as invalidateEntityRevisionsListCache,
    invalidateTestsetCache as invalidateEntityTestsetCache,
    invalidateTestsetsListCache as invalidateEntityTestsetsListCache,
} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {
    createNewTestset,
    patchTestsetRevision,
    type TestsetRevisionDelta,
} from "@/oss/services/testsets/api"
import {currentColumnsAtom} from "@/oss/state/entities/testcase"
import {
    fetchRevisionsList,
    invalidateRevisionsListCache as invalidateOssRevisionsListCache,
    invalidateTestsetCache as invalidateOssTestsetCache,
    invalidateTestsetsListCache as invalidateOssTestsetsListCache,
} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project"
import {clearRevisionsCacheAtom, setRevisionsForTestsetAtom} from "@/oss/state/testsetSelection"

import {isNewTestsetAtom, newTestsetNameAtom, selectedTestsetInfoAtom} from "../atoms/cascaderState"
import {
    mappingDataAtom,
    selectedRevisionIdAtom,
    traceDataFromEntitiesAtom,
} from "../atoms/drawerState"
import {
    commitMessageAtom,
    convertTraceDataAtom,
    hasNewColumnsAtom,
    isSavingAtom,
    localTestsetColumnsAtom,
    localTestsetRowsAtom,
    newColumnCreatedAtom,
    resetSaveStateAtom,
    showConfirmSaveAtom,
} from "../atoms/saveState"

import {useTestsetRevisionSelect} from "./useTestsetRevisionSelect"

/**
 * Hook for testset save operations
 *
 * Uses atoms for state management to prevent prop drilling.
 * Handles both new testset creation and updating existing testsets.
 */
export function useSaveTestset() {
    const projectId = useAtomValue(projectIdAtom)

    // Revision select hook for testset/revision state
    const revisionSelect = useTestsetRevisionSelect()

    // Save state atoms
    const [isSaving, setIsSaving] = useAtom(isSavingAtom)
    const [commitMessage, setCommitMessage] = useAtom(commitMessageAtom)
    const [showConfirmSave, setShowConfirmSave] = useAtom(showConfirmSaveAtom)
    const [localColumns, setLocalColumns] = useAtom(localTestsetColumnsAtom)
    const [localRows, setLocalRows] = useAtom(localTestsetRowsAtom)
    const resetSaveState = useSetAtom(resetSaveStateAtom)

    // Derived state
    const isNewTestset = useAtomValue(isNewTestsetAtom)
    const hasNewColumns = useAtomValue(hasNewColumnsAtom)
    const newColumnCreated = useAtomValue(newColumnCreatedAtom)
    const newTestsetName = useAtomValue(newTestsetNameAtom)
    const testset = useAtomValue(selectedTestsetInfoAtom)
    const selectedRevisionId = useAtomValue(selectedRevisionIdAtom)

    // Data atoms - use entity-derived trace data (not the primitive traceDataAtom)
    const traceData = useAtomValue(traceDataFromEntitiesAtom)
    const mappingData = useAtomValue(mappingDataAtom)
    const currentColumns = useAtomValue(currentColumnsAtom)

    const convertTraceData = useSetAtom(convertTraceDataAtom)

    // Revision select setters
    const setSelectedRevisionId = useSetAtom(selectedRevisionIdAtom)
    const setRevisionsForTestset = useSetAtom(setRevisionsForTestsetAtom)
    const clearRevisionsCache = useSetAtom(clearRevisionsCacheAtom)

    const invalidateSelectionCaches = useCallback(
        (testsetId?: string) => {
            // Invalidate both entity-package and OSS testset caches so all
            // selectors/modals (including Testset Sync modal) see fresh data.
            invalidateEntityTestsetsListCache()
            invalidateOssTestsetsListCache()

            if (testsetId) {
                invalidateEntityTestsetCache(testsetId)
                invalidateEntityRevisionsListCache(testsetId)
                invalidateOssTestsetCache(testsetId)
                invalidateOssRevisionsListCache(testsetId)
            }

            // Clear shared in-memory revisions map used by selection UIs.
            clearRevisionsCache()
        },
        [clearRevisionsCache],
    )

    /**
     * Convert trace data to export format
     */
    const getExportData = useCallback(() => {
        const columns = isNewTestset
            ? localColumns.map((c) => c.column)
            : currentColumns.map((c) => c.key)

        return convertTraceData({
            traceData,
            mappings: mappingData,
            columns,
            existingRows: isNewTestset ? [] : localRows,
        })
    }, [
        traceData,
        mappingData,
        localColumns,
        currentColumns,
        localRows,
        isNewTestset,
        convertTraceData,
    ])

    /**
     * Save testset (create new or update existing)
     */
    const saveTestset = useCallback(
        async (options?: {onSuccess?: () => void}) => {
            try {
                setIsSaving(true)

                if (!projectId) {
                    message.error("Missing project information")
                    return {success: false, error: "Missing project information"}
                }

                if (isNewTestset) {
                    // Create new testset
                    if (!newTestsetName) {
                        message.error("Please add a Testset name before saving it")
                        return {success: false, error: "Missing testset name"}
                    }

                    // Only compute export data for new testsets (API expects full data)
                    const exportData = getExportData()
                    const response = await createNewTestset(
                        newTestsetName,
                        exportData,
                        commitMessage || undefined,
                    )

                    if (!response?.data?.revisionId || !response?.data?.testset?.id) {
                        throw new Error("Failed to create testset: no revision ID returned")
                    }

                    const newTestsetId = response.data.testset.id
                    const createdRevisionId = response.data.revisionId

                    message.success(
                        commitMessage
                            ? `Testset created with message: "${commitMessage}"`
                            : "Testset created successfully",
                    )

                    invalidateSelectionCaches(newTestsetId)

                    // Refetch testsets list so the new testset appears
                    await revisionSelect.refetchTestsets()

                    // Reset state and close drawer
                    // NOTE: We don't set revision ID here because the drawer is closing
                    // Setting it would trigger entity fetches that get cancelled
                    resetSaveState()
                    options?.onSuccess?.()

                    return {success: true, testsetId: newTestsetId, revisionId: createdRevisionId}
                } else {
                    // Update existing testset
                    if (!testset.id) {
                        message.error("Missing testset information")
                        return {success: false, error: "Missing testset information"}
                    }

                    const mappedColumns = Array.from(
                        new Set(
                            mappingData
                                .map((mapping) =>
                                    mapping.column === "create" || !mapping.column
                                        ? mapping.newColumn
                                        : mapping.column,
                                )
                                .filter((column): column is string => !!column),
                        ),
                    )

                    const rowsToAdd = convertTraceData({
                        traceData,
                        mappings: mappingData,
                        columns: mappedColumns,
                    }).map((data) => ({data}))

                    const newColumnNames = new Set(
                        localColumns
                            .filter((column) => column.isNew)
                            .map((column) => column.column)
                            .filter(Boolean),
                    )

                    const operations: TestsetRevisionDelta = {
                        rows: {
                            add: rowsToAdd,
                        },
                    }

                    if (newColumnNames.size > 0) {
                        operations.columns = {
                            add: Array.from(newColumnNames),
                        }
                    }

                    const response = await patchTestsetRevision(
                        testset.id,
                        operations,
                        commitMessage || undefined,
                        selectedRevisionId || undefined,
                    )
                    const newRevisionId = response?.testset_revision?.id as string | undefined

                    if (!response?.testset_revision) {
                        const detail =
                            (response as {detail?: string; error?: string; message?: string})
                                ?.detail ||
                            (response as {detail?: string; error?: string; message?: string})
                                ?.error ||
                            (response as {detail?: string; error?: string; message?: string})
                                ?.message

                        throw new Error(
                            detail || "Failed to update testset: revision commit was not created",
                        )
                    }

                    if (newRevisionId) {
                        message.success(
                            commitMessage
                                ? `Saved with message: "${commitMessage}"`
                                : "Testset updated successfully",
                        )

                        // Reload revisions and update cache
                        try {
                            invalidateSelectionCaches(testset.id)

                            const response = await fetchRevisionsList({
                                projectId,
                                testsetId: testset.id,
                            })
                            setRevisionsForTestset({
                                testsetId: testset.id,
                                revisions: response.testset_revisions,
                            })

                            setSelectedRevisionId(newRevisionId)
                            revisionSelect.setCurrentRevisionId(newRevisionId)
                        } catch (error) {
                            console.error("Failed to reload revisions:", error)
                        }

                        await revisionSelect.refetchTestsets()
                        resetSaveState()
                        options?.onSuccess?.()

                        return {success: true, revisionId: newRevisionId}
                    } else {
                        throw new Error("Failed to update testset: missing new revision ID")
                    }
                }
            } catch (error) {
                console.error(error)
                message.error("Something went wrong. Please try again later")
                return {success: false, error}
            } finally {
                setIsSaving(false)
            }
        },
        [
            projectId,
            isNewTestset,
            newTestsetName,
            testset.id,
            selectedRevisionId,
            commitMessage,
            traceData,
            mappingData,
            localColumns,
            getExportData,
            convertTraceData,
            setSelectedRevisionId,
            setRevisionsForTestset,
            revisionSelect,
            resetSaveState,
            setIsSaving,
            invalidateSelectionCaches,
        ],
    )

    /**
     * Handle save button click
     * Shows confirm modal if new columns exist, otherwise saves directly
     */
    const handleSave = useCallback(
        (options?: {onSuccess?: () => void}) => {
            if (!isNewTestset && hasNewColumns) {
                setShowConfirmSave(true)
            } else {
                saveTestset(options)
            }
        },
        [isNewTestset, hasNewColumns, setShowConfirmSave, saveTestset],
    )

    /**
     * Confirm save (from modal)
     */
    const confirmSave = useCallback(
        (options?: {onSuccess?: () => void}) => {
            setShowConfirmSave(false)
            saveTestset(options)
        },
        [setShowConfirmSave, saveTestset],
    )

    /**
     * Cancel save (from modal)
     */
    const cancelSave = useCallback(() => {
        setShowConfirmSave(false)
    }, [setShowConfirmSave])

    return {
        // State
        isSaving,
        commitMessage,
        showConfirmSave,
        localColumns,
        localRows,
        isNewTestset,
        hasNewColumns,
        newColumnCreated,
        testset,

        // Setters
        setCommitMessage,
        setShowConfirmSave,
        setLocalColumns,
        setLocalRows,

        // Handlers
        saveTestset,
        handleSave,
        confirmSave,
        cancelSave,
        getExportData,
        resetSaveState,
    }
}
