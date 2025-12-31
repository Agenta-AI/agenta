import {useCallback} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {createNewTestset} from "@/oss/services/testsets/api"
import {currentColumnsAtom, saveTestsetAtom} from "@/oss/state/entities/testcase"
import {fetchRevisionsList} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project"
import {setRevisionsForTestsetAtom} from "@/oss/state/testsetSelection"

import {isNewTestsetAtom, newTestsetNameAtom, selectedTestsetInfoAtom} from "../atoms/cascaderState"
import {mappingDataAtom, selectedRevisionIdAtom, traceDataFromEntitiesAtom} from "../atoms/drawerState"
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

    // Entity mutations
    const executeSaveTestset = useSetAtom(saveTestsetAtom)
    const convertTraceData = useSetAtom(convertTraceDataAtom)

    // Revision select setters
    const setSelectedRevisionId = useSetAtom(selectedRevisionIdAtom)
    const setRevisionsForTestset = useSetAtom(setRevisionsForTestsetAtom)

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
                    const response = await createNewTestset(newTestsetName, exportData)

                    if (!response?.data?.revisionId || !response?.data?.testset?.id) {
                        throw new Error("Failed to create testset: no revision ID returned")
                    }

                    const newTestsetId = response.data.testset.id
                    const createdRevisionId = response.data.revisionId

                    message.success("Testset created successfully")

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

                    // NOTE: We don't call appendTestcasesAtom here because local entities
                    // are already created by selectRevisionAtom when the user selects a revision.
                    // Those entities are in newEntityIdsAtom and will be picked up by saveTestsetAtom.
                    // Calling appendTestcasesAtom would create duplicates because its deduplication
                    // compares JSON.stringify of rows which may have different column sets.

                    // Save via entity mutation
                    const result = await executeSaveTestset({
                        projectId,
                        testsetId: testset.id,
                        revisionId: selectedRevisionId,
                        commitMessage: commitMessage || undefined,
                    })

                    if (result.success && result.newRevisionId) {
                        message.success(
                            commitMessage
                                ? `Saved with message: "${commitMessage}"`
                                : "Testset updated successfully",
                        )

                        // Reload revisions and update cache
                        try {
                            const response = await fetchRevisionsList({
                                projectId,
                                testsetId: testset.id,
                            })
                            setRevisionsForTestset({
                                testsetId: testset.id,
                                revisions: response.testset_revisions,
                            })

                            setSelectedRevisionId(result.newRevisionId)
                            revisionSelect.setCurrentRevisionId(result.newRevisionId)
                        } catch (error) {
                            console.error("Failed to reload revisions:", error)
                        }

                        await revisionSelect.refetchTestsets()
                        resetSaveState()
                        options?.onSuccess?.()

                        return {success: true, revisionId: result.newRevisionId}
                    } else {
                        throw result.error || new Error("Save failed")
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
            traceData.length,
            getExportData,
            executeSaveTestset,
            setSelectedRevisionId,
            setRevisionsForTestset,
            revisionSelect,
            resetSaveState,
            setIsSaving,
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
