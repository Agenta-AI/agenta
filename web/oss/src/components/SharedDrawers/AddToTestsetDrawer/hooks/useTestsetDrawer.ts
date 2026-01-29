import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"
import yaml from "js-yaml"

import {message} from "@/oss/components/AppMessageContext"
import {getYamlOrJson} from "@/oss/lib/helpers/utils"
import {currentColumnsAtom} from "@/oss/state/entities/testcase/columnState"
import {getValueAtPath} from "@/oss/state/entities/trace"
import {projectIdAtom} from "@/oss/state/project"

import {createMappingId, Mapping, TestsetColumn, TestsetTraceData} from "../assets/types"
import {onCascaderChangeAtom} from "../atoms/actions"
import {
    allTracePathsSelectOptionsAtom,
    closeDrawerAtom,
    hasDifferentStructureAtom,
    hasDuplicateColumnsAtom,
    mappingDataAtom,
    onMappingChangeAtom,
    onNewColumnBlurAtom,
    previewKeyAtom,
    removeTraceDataAtom,
    revertEditedTraceAtom,
    rowDataPreviewAtom,
    selectedTraceDataAtom,
    traceDataFromEntitiesAtom,
    updateEditedTraceAtom,
} from "../atoms/drawerState"
import {clearLocalEntitiesAtom} from "../atoms/localEntities"
import {resetSaveStateAtom} from "../atoms/saveState"

import {useSaveTestset} from "./useSaveTestset"
import {useTestsetRevisionSelect} from "./useTestsetRevisionSelect"

export interface UseTestsetDrawerResult {
    // State
    projectId: string | null
    traceData: TestsetTraceData[]
    mappingData: Mapping[]
    previewKey: string
    selectedRevisionId: string
    hasDuplicateColumns: boolean
    currentColumns: {key: string; name: string}[]
    isTestsetsLoading: boolean
    cascaderOptions: any[]
    cascaderValue: string[]
    isDrawerExtended: boolean
    isLoading: boolean
    updatedTraceData: string
    testset: {name: string; id: string}
    availableRevisions: {id: string; version: number | null}[]
    newTestsetName: string
    editorFormat: "JSON" | "YAML"
    selectedTestsetColumns: TestsetColumn[]
    rowDataPreview: string
    isConfirmSave: boolean
    commitMessage: string
    isDifferStructureExist: boolean
    isNewTestset: boolean
    isNewColumnCreated: TestsetColumn | undefined
    isMapColumnExist: boolean
    selectedTraceData: TestsetTraceData | undefined
    formatDataPreview: string
    allAvailablePaths: {value: string; label: string}[]
    columnOptions: {value: string; label: string}[]
    /** Map of data paths to column names (for visual indication in drill-in view) */
    mappedPaths: Map<string, string>
    /** Handler to add a mapping from the drill-in view */
    onMapToColumnFromDrillIn: (dataPath: string, column: string) => void
    /** Handler to remove a mapping from the drill-in view */
    onUnmapFromDrillIn: (dataPath: string) => void

    // Setters
    setMappingData: (data: Mapping[] | ((prev: Mapping[]) => Mapping[])) => void
    setPreviewKey: (key: string) => void
    setHasDuplicateColumns: (value: boolean) => void
    setIsDrawerExtended: React.Dispatch<React.SetStateAction<boolean>>
    setUpdatedTraceData: React.Dispatch<React.SetStateAction<string>>
    setNewTestsetName: (name: string) => void
    setEditorFormat: React.Dispatch<React.SetStateAction<"JSON" | "YAML">>
    setSelectedTestsetColumns: React.Dispatch<React.SetStateAction<TestsetColumn[]>>
    setRowDataPreview: React.Dispatch<React.SetStateAction<string>>
    setIsConfirmSave: (value: boolean) => void
    setCommitMessage: (value: string) => void

    // Handlers
    handleDrawerClose: () => void
    loadRevisions: (selectedOptions: any[]) => Promise<void>
    onCascaderChange: (value: any, selectedOptions: any[]) => void
    onRemoveTraceData: () => void
    onMappingOptionChange: (params: {pathName: keyof Mapping; value: string; idx: number}) => void
    onRemoveMapping: (idx: number) => void
    onNewColumnBlur: () => void
    onPreviewOptionChange: (value: string) => void
    onSaveTestset: (onCloseCallback?: () => void) => Promise<void>
    onSaveEditedTrace: (value?: string) => void
    onRevertEditedTrace: () => void
    customSelectOptions: (divider?: boolean) => any[]
    renderSelectedRevisionLabel: (labels: string[], selectedOptions?: any[]) => string

    // Refs
    elemRef: React.RefObject<HTMLDivElement>
}

export function useTestsetDrawer(): UseTestsetDrawerResult {
    const projectId = useAtomValue(projectIdAtom)

    // Use the testset revision select hook (atom-based state)
    const revisionSelect = useTestsetRevisionSelect()

    // Use the save testset hook (atom-based state)
    const saveTestset = useSaveTestset()

    // Entity-based columns (for selected revision)
    const currentColumns = useAtomValue(currentColumnsAtom)

    // Drawer state atoms (trace data is derived from entity atoms)
    const [mappingData, setMappingData] = useAtom(mappingDataAtom)
    const traceData = useAtomValue(traceDataFromEntitiesAtom)
    const [previewKey, setPreviewKey] = useAtom(previewKeyAtom)
    const [hasDuplicateColumns, setHasDuplicateColumns] = useAtom(hasDuplicateColumnsAtom)
    const [rowDataPreview, setRowDataPreview] = useAtom(rowDataPreviewAtom)

    // Trace data actions
    const closeDrawer = useSetAtom(closeDrawerAtom)
    const removeTraceData = useSetAtom(removeTraceDataAtom)
    const updateEditedTrace = useSetAtom(updateEditedTraceAtom)
    const revertEditedTrace = useSetAtom(revertEditedTraceAtom)

    // Selected trace data (derived from atom)
    const selectedTraceData = useAtomValue(selectedTraceDataAtom)

    // Structural difference (derived from atom)
    const isDifferStructureExist = useAtomValue(hasDifferentStructureAtom)

    // Local entity operations
    const clearLocalEntities = useSetAtom(clearLocalEntitiesAtom)

    // Unified action atoms
    const onCascaderChange = useSetAtom(onCascaderChangeAtom)
    const resetSaveState = useSetAtom(resetSaveStateAtom)

    // Mapping change reducers
    const executeMappingChange = useSetAtom(onMappingChangeAtom)
    const executeNewColumnBlur = useSetAtom(onNewColumnBlurAtom)

    // Local state (UI-only, not shared)
    const [isDrawerExtended, setIsDrawerExtended] = useState(false)
    const [updatedTraceData, setUpdatedTraceData] = useState("")
    const [editorFormat, setEditorFormat] = useState<"JSON" | "YAML">("JSON")

    // Refs
    const elemRef = useRef<HTMLDivElement>(null)

    const isNewColumnCreated = useMemo(
        () => saveTestset.localColumns.find(({isNew}) => isNew),
        [saveTestset.localColumns],
    )

    const isMapColumnExist = useMemo(
        () =>
            mappingData.some((mapping) =>
                mapping.column === "create" || !mapping.column
                    ? !!mapping?.newColumn
                    : !!mapping.column,
            ),
        [mappingData],
    )

    // All available data paths from trace data (derived from atom)
    const allAvailablePaths = useAtomValue(allTracePathsSelectOptionsAtom)

    // Auto-map first available path when no mappings exist and data is available
    useEffect(() => {
        if (!isMapColumnExist && allAvailablePaths.length > 0 && mappingData.length === 0) {
            const firstPath = allAvailablePaths[0].value
            const pathLabel = allAvailablePaths[0].label

            // Auto-map to a reasonable column name based on the path
            let columnName = pathLabel

            // Clean up the column name
            columnName = columnName
                .replace(/[^a-zA-Z0-9_]/g, "_")
                .replace(/^[^a-zA-Z_]/, "_")
                .replace(/_+/g, "_")
                .toLowerCase()

            // Ensure it's not empty
            if (!columnName || columnName === "_") {
                columnName = "field_1"
            }

            setMappingData([
                {
                    id: createMappingId(),
                    data: firstPath,
                    column: "create",
                    newColumn: columnName,
                },
            ])
        }
    }, [isMapColumnExist, allAvailablePaths, mappingData.length, setMappingData])

    // Compute map of data paths to column names for visual indication in drill-in view
    const mappedPaths = useMemo(() => {
        const paths = new Map<string, string>()
        mappingData.forEach((mapping) => {
            if (mapping.data && mapping.column) {
                // Use newColumn for "create" mappings, otherwise use column
                const columnName =
                    mapping.column === "create"
                        ? mapping.newColumn || mapping.column
                        : mapping.column
                paths.set(mapping.data, columnName)
            }
        })
        return paths
    }, [mappingData])

    // Handler to add a mapping from the drill-in view
    const onMapToColumnFromDrillIn = useCallback(
        (dataPath: string, column: string) => {
            // Add a new mapping with the data path and column
            // "create" is a special value that means create a new column - leave newColumn empty for user input
            if (column === "create") {
                setMappingData((prev) => [
                    ...prev,
                    {id: createMappingId(), data: dataPath, column: "create", newColumn: ""},
                ])
                // Scroll to mapping section so user can fill in the column name
                setTimeout(() => {
                    const mappingSection = document.querySelector('[data-testid="mapping-section"]')
                    mappingSection?.scrollIntoView({behavior: "smooth", block: "center"})
                }, 100)
            } else {
                setMappingData((prev) => [...prev, {id: createMappingId(), data: dataPath, column}])
                // Trigger entity update to sync columns to preview table
                executeNewColumnBlur(getValueAtPath)
            }
        },
        [setMappingData, executeNewColumnBlur],
    )

    // Handler to remove a mapping from the drill-in view
    const onUnmapFromDrillIn = useCallback(
        (dataPath: string) => {
            setMappingData((prev) => prev.filter((mapping) => mapping.data !== dataPath))
            // Trigger entity update to sync columns to preview table
            executeNewColumnBlur(getValueAtPath)
        },
        [setMappingData, executeNewColumnBlur],
    )

    // Handler to remove a mapping by index (from MappingSection)
    const onRemoveMapping = useCallback(
        (idx: number) => {
            setMappingData((prev) => prev.filter((_, index) => index !== idx))
            // Trigger entity update to sync columns to preview table
            executeNewColumnBlur(getValueAtPath)
        },
        [setMappingData, executeNewColumnBlur],
    )

    const formatDataPreview = useMemo(() => {
        if (!traceData?.length) return ""
        const jsonObject = {data: selectedTraceData?.data || traceData[0]?.data}
        if (!jsonObject) return ""
        return getYamlOrJson(editorFormat, jsonObject)
    }, [editorFormat, traceData, selectedTraceData])

    // Derive column options from entity atoms + columns created via mappings
    const columnOptions = useMemo(() => {
        const baseColumns = revisionSelect.isNewTestset
            ? (saveTestset.localColumns?.map(({column}) => ({
                  value: column,
                  label: column,
              })) ?? [])
            : currentColumns.map((col) => ({
                  value: col.key,
                  label: col.name,
              }))

        // Also include columns created via mappings (not "create" placeholder)
        const mappingColumns = mappingData
            .filter((m) => m.column && m.column !== "create")
            .map((m) => ({value: m.column, label: m.column}))

        // Merge and dedupe by value
        const allColumns = [...baseColumns, ...mappingColumns]
        const seen = new Set<string>()
        return allColumns.filter((col) => {
            if (seen.has(col.value)) return false
            seen.add(col.value)
            return true
        })
    }, [currentColumns, saveTestset.localColumns, revisionSelect.isNewTestset, mappingData])

    const handleDrawerClose = useCallback(() => {
        // Close drawer via reducer (resets drawer state, cascader state)
        closeDrawer()
        // Reset save state via reducer
        resetSaveState()
        // Clear local entities via reducer
        clearLocalEntities()
        // Reset local UI state
        setUpdatedTraceData("")
    }, [closeDrawer, resetSaveState, clearLocalEntities])

    // Handle cascader change - single atom handles entire flow
    const handleCascaderChange = useCallback(
        (value: any, selectedOptions: any[]) => {
            onCascaderChange({value, selectedOptions})
        },
        [onCascaderChange],
    )

    const onRemoveTraceData = useCallback(() => {
        // Use the atom action which handles all state updates
        removeTraceData(rowDataPreview)
    }, [rowDataPreview, removeTraceData])

    const onMappingOptionChange = useCallback(
        ({pathName, value, idx}: {pathName: keyof Mapping; value: string; idx: number}) => {
            // Use reducer atom - handles mapping update AND entity update atomically
            executeMappingChange({pathName, value, idx, getValueAtPath})
        },
        [executeMappingChange],
    )

    const onNewColumnBlur = useCallback(() => {
        // Use reducer atom - triggers entity update with current mappings
        executeNewColumnBlur(getValueAtPath)
    }, [executeNewColumnBlur])

    const onPreviewOptionChange = useCallback(
        (value: string) => {
            setPreviewKey(value)
        },
        [setPreviewKey],
    )

    // Save handler using the save hook
    // Accepts optional onClose callback to dismiss the drawer after successful save
    const onSaveTestset = useCallback(
        async (onCloseCallback?: () => void) => {
            await saveTestset.saveTestset({
                onSuccess: () => {
                    handleDrawerClose()
                    onCloseCallback?.()
                },
            })
        },
        [saveTestset, handleDrawerClose],
    )

    const onSaveEditedTrace = useCallback(
        (valueToSave?: string) => {
            const dataToSave = valueToSave || updatedTraceData
            console.log("[onSaveEditedTrace] Called", {
                dataToSave: dataToSave?.slice(0, 100),
            })
            // Always call updateEditedTrace - it handles comparison against original data internally
            // Don't compare against formatDataPreview here because it reflects current (possibly edited) data
            if (dataToSave) {
                console.log("[onSaveEditedTrace] Calling updateEditedTrace")
                const result = updateEditedTrace({
                    updatedData: dataToSave,
                    format: editorFormat,
                    parseYaml: yaml.load as (str: string) => unknown,
                    formatData: getYamlOrJson,
                    getValueAtPath, // Pass getValueAtPath to update local entities
                })
                console.log("[onSaveEditedTrace] Result:", result)

                if (!result.success && result.error && result.error !== "No changes detected") {
                    message.error(result.error)
                }
            }
        },
        [updatedTraceData, editorFormat, updateEditedTrace],
    )

    const onRevertEditedTrace = useCallback(() => {
        const result = revertEditedTrace({getValueAtPath})
        if (result.success) {
            setUpdatedTraceData("") // Clear the local editor state
        }
    }, [revertEditedTrace, setUpdatedTraceData])

    // NOTE: No useEffects for testset/revision selection!
    // Reducers are called directly from handleCascaderChange (user action)
    // This eliminates side-effect based state management

    return {
        // State
        projectId,
        traceData,
        mappingData,
        previewKey,
        selectedRevisionId: revisionSelect.selectedRevisionId,
        hasDuplicateColumns,
        currentColumns,
        isTestsetsLoading: revisionSelect.isTestsetsLoading,
        cascaderOptions: revisionSelect.cascaderOptions,
        cascaderValue: revisionSelect.cascaderValue,
        isDrawerExtended,
        isLoading: saveTestset.isSaving,
        updatedTraceData,
        testset: revisionSelect.testset,
        availableRevisions: revisionSelect.availableRevisions,
        newTestsetName: revisionSelect.newTestsetName,
        editorFormat,
        selectedTestsetColumns: saveTestset.localColumns,
        rowDataPreview,
        isConfirmSave: saveTestset.showConfirmSave,
        commitMessage: saveTestset.commitMessage,
        isDifferStructureExist,
        isNewTestset: revisionSelect.isNewTestset,
        isNewColumnCreated,
        isMapColumnExist,
        selectedTraceData,
        formatDataPreview,
        allAvailablePaths,
        columnOptions,
        mappedPaths,
        onMapToColumnFromDrillIn,
        onUnmapFromDrillIn,

        // Setters
        setMappingData,
        setPreviewKey,
        setHasDuplicateColumns,
        setIsDrawerExtended,
        setUpdatedTraceData,
        setNewTestsetName: revisionSelect.setNewTestsetName,
        setEditorFormat,
        setSelectedTestsetColumns: saveTestset.setLocalColumns,
        setRowDataPreview,
        setIsConfirmSave: saveTestset.setShowConfirmSave,
        setCommitMessage: saveTestset.setCommitMessage,

        // Handlers
        handleDrawerClose,
        loadRevisions: revisionSelect.loadRevisions,
        onCascaderChange: handleCascaderChange,
        onRemoveTraceData,
        onMappingOptionChange,
        onRemoveMapping,
        onNewColumnBlur,
        onPreviewOptionChange,
        onSaveTestset,
        onSaveEditedTrace,
        onRevertEditedTrace,
        customSelectOptions: revisionSelect.customSelectOptions,
        renderSelectedRevisionLabel: revisionSelect.renderSelectedRevisionLabel,

        // Refs
        elemRef,
    }
}
