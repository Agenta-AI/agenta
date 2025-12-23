import {useCallback} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {fetchTestsetRevisions} from "@/oss/components/TestsetsTable/atoms/fetchTestsetRevisions"
import {createNewTestset} from "@/oss/services/testsets/api"
import {currentColumnsAtom} from "@/oss/state/entities/testcase/columnState"
import {appendTestcasesAtom, saveTestsetAtom} from "@/oss/state/entities/testcase/mutations"
import {projectIdAtom} from "@/oss/state/project"

import {
    availableRevisionsAtom,
    isNewTestsetAtom,
    newTestsetNameAtom,
    selectedTestsetInfoAtom,
} from "../atoms/cascaderState"
import {mappingDataAtom, selectedRevisionIdAtom, traceDataAtom} from "../atoms/drawerState"
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

    // Data atoms
    const traceData = useAtomValue(traceDataAtom)
    const mappingData = useAtomValue(mappingDataAtom)
    const currentColumns = useAtomValue(currentColumnsAtom)

    // Entity mutations
    const executeAppendTestcases = useSetAtom(appendTestcasesAtom)
    const executeSaveTestset = useSetAtom(saveTestsetAtom)
    const convertTraceData = useSetAtom(convertTraceDataAtom)

    // Revision select setters
    const setTestset = useSetAtom(selectedTestsetInfoAtom)
    const setSelectedRevisionId = useSetAtom(selectedRevisionIdAtom)
    const setAvailableRevisions = useSetAtom(availableRevisionsAtom)

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

                const exportData = getExportData()

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

                    const response = await createNewTestset(newTestsetName, exportData)

                    if (!response?.data?.revisionId || !response?.data?.testset?.id) {
                        throw new Error("Failed to create testset: no revision ID returned")
                    }

                    const newTestsetId = response.data.testset.id
                    const createdRevisionId = response.data.revisionId

                    message.success("Testset created successfully")

                    // Update state
                    setTestset({name: newTestsetName, id: newTestsetId})
                    setSelectedRevisionId(createdRevisionId)
                    revisionSelect.setCurrentRevisionId(createdRevisionId)

                    // Load revisions
                    try {
                        const revisions = await fetchTestsetRevisions({testsetId: newTestsetId})
                        setAvailableRevisions(
                            revisions.map((rev) => ({
                                id: rev.id,
                                version: rev.version != null ? Number(rev.version) : null,
                            })),
                        )
                    } catch (error) {
                        console.error("Failed to load revisions:", error)
                    }

                    await revisionSelect.refetchTestsets()
                    resetSaveState()
                    options?.onSuccess?.()

                    return {success: true, testsetId: newTestsetId, revisionId: createdRevisionId}
                } else {
                    // Update existing testset
                    if (!testset.id) {
                        message.error("Missing testset information")
                        return {success: false, error: "Missing testset information"}
                    }

                    // Add testcases to entity state
                    const addedCount = executeAppendTestcases(exportData)
                    console.log(`Added ${addedCount} testcases to entity state`)

                    // Save via entity mutation
                    const result = await executeSaveTestset({
                        projectId,
                        testsetId: testset.id,
                        revisionId: selectedRevisionId,
                        commitMessage:
                            commitMessage || `Added ${traceData.length} span(s) to testset`,
                    })

                    if (result.success && result.newRevisionId) {
                        message.success(
                            commitMessage
                                ? `Saved with message: "${commitMessage}"`
                                : "Testset updated successfully",
                        )

                        // Reload revisions
                        try {
                            const revisions = await fetchTestsetRevisions({testsetId: testset.id})
                            setAvailableRevisions(
                                revisions.map((rev) => ({
                                    id: rev.id,
                                    version: rev.version != null ? Number(rev.version) : null,
                                })),
                            )

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
            executeAppendTestcases,
            executeSaveTestset,
            setTestset,
            setSelectedRevisionId,
            setAvailableRevisions,
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
