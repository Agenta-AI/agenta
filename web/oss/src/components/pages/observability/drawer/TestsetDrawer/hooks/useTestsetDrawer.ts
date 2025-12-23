import {useCallback, useMemo, useRef, useState} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"
import yaml from "js-yaml"

import {message} from "@/oss/components/AppMessageContext"
import {getYamlOrJson} from "@/oss/lib/helpers/utils"
import {currentColumnsAtom} from "@/oss/state/entities/testcase/columnState"
import {getValueAtPath} from "@/oss/state/entities/trace"
import {projectIdAtom} from "@/oss/state/project"

import {Mapping, TestsetColumn, TestsetTraceData} from "../assets/types"
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
    rowDataPreviewAtom,
    selectedTraceDataAtom,
    traceDataAtom,
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
    loadingRevisions: boolean
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

    // Setters
    setMappingData: (data: Mapping[] | ((prev: Mapping[]) => Mapping[])) => void
    setTraceDataState: (
        data: TestsetTraceData[] | ((prev: TestsetTraceData[]) => TestsetTraceData[]),
    ) => void
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
    onNewColumnBlur: () => void
    onPreviewOptionChange: (value: string) => void
    onSaveTestset: () => Promise<void>
    onSaveEditedTrace: () => void
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

    // Drawer state atoms (trace data is set via openDrawerAtom from parent)
    const [mappingData, setMappingData] = useAtom(mappingDataAtom)
    const [traceDataState, setTraceDataState] = useAtom(traceDataAtom)
    const [previewKey, setPreviewKey] = useAtom(previewKeyAtom)
    const [hasDuplicateColumns, setHasDuplicateColumns] = useAtom(hasDuplicateColumnsAtom)
    const [rowDataPreview, setRowDataPreview] = useAtom(rowDataPreviewAtom)

    // Trace data actions
    const closeDrawer = useSetAtom(closeDrawerAtom)
    const removeTraceData = useSetAtom(removeTraceDataAtom)
    const updateEditedTrace = useSetAtom(updateEditedTraceAtom)

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

    // traceData is now managed by traceDataAtom
    const traceData = traceDataState

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

    const formatDataPreview = useMemo(() => {
        if (!traceData?.length) return ""
        const jsonObject = {data: selectedTraceData?.data || traceData[0]?.data}
        if (!jsonObject) return ""
        return getYamlOrJson(editorFormat, jsonObject)
    }, [editorFormat, traceData, selectedTraceData])

    // All available data paths from trace data (derived from atom)
    const allAvailablePaths = useAtomValue(allTracePathsSelectOptionsAtom)

    // Derive column options directly from entity atoms
    const columnOptions = useMemo(() => {
        if (revisionSelect.isNewTestset) {
            return saveTestset.localColumns?.map(({column}) => ({
                value: column,
                label: column,
            }))
        }
        return currentColumns.map((col) => ({
            value: col.key,
            label: col.name,
        }))
    }, [currentColumns, saveTestset.localColumns, revisionSelect.isNewTestset])

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
    const onSaveTestset = useCallback(async () => {
        await saveTestset.saveTestset({onSuccess: handleDrawerClose})
    }, [saveTestset, handleDrawerClose])

    const onSaveEditedTrace = useCallback(() => {
        if (updatedTraceData && updatedTraceData !== formatDataPreview) {
            const result = updateEditedTrace({
                updatedData: updatedTraceData,
                format: editorFormat,
                parseYaml: yaml.load as (str: string) => unknown,
                formatData: getYamlOrJson,
            })

            if (!result.success && result.error) {
                message.error(result.error)
            }
        }
    }, [updatedTraceData, formatDataPreview, editorFormat, updateEditedTrace])

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
        loadingRevisions: revisionSelect.loadingRevisions,
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

        // Setters
        setMappingData,
        setTraceDataState,
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
        onNewColumnBlur,
        onPreviewOptionChange,
        onSaveTestset,
        onSaveEditedTrace,
        customSelectOptions: revisionSelect.customSelectOptions,
        renderSelectedRevisionLabel: revisionSelect.renderSelectedRevisionLabel,

        // Refs
        elemRef,
    }
}
