import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import Editor from "@monaco-editor/react"
import {
    ArrowRight,
    FloppyDiskBack,
    PencilSimple,
    Plus,
    Trash,
    WarningCircle,
} from "@phosphor-icons/react"
import {
    AutoComplete,
    Button,
    Cascader,
    Divider,
    Input,
    Modal,
    Radio,
    Select,
    Typography,
} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import yaml from "js-yaml"

import {message} from "@/oss/components/AppMessageContext"
import CopyButton from "@/oss/components/CopyButton/CopyButton"
import GenericDrawer from "@/oss/components/GenericDrawer"
import {useRowHeight} from "@/oss/components/InfiniteVirtualTable"
import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {UserReference} from "@/oss/components/References/UserReference"
import {TestcasesTableShell} from "@/oss/components/TestcasesTableNew/components/TestcasesTableShell"
import {useTestcasesTable} from "@/oss/components/TestcasesTableNew/hooks/useTestcasesTable"
import {
    testcaseRowHeightAtom,
    TESTCASE_ROW_HEIGHT_CONFIG,
} from "@/oss/components/TestcasesTableNew/state/rowHeight"
import {fetchTestsetRevisions} from "@/oss/components/TestsetsTable/atoms/fetchTestsetRevisions"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import useResizeObserver from "@/oss/hooks/useResizeObserver"
import {getYamlOrJson} from "@/oss/lib/helpers/utils"
import {KeyValuePair} from "@/oss/lib/Types"
import {createNewTestset} from "@/oss/services/testsets/api"
import {addColumnAtom, currentColumnsAtom} from "@/oss/state/entities/testcase/columnState"
import {appendTestcasesAtom, saveTestsetAtom} from "@/oss/state/entities/testcase/mutations"
import {testsetNameQueryAtom} from "@/oss/state/entities/testcase/queries"
import {currentRevisionIdAtom} from "@/oss/state/entities/testset"
import {
    collectKeyPaths,
    filterDataPaths,
    getValueAtPath,
    matchColumnsWithSuggestions,
    pathsToSelectOptions,
} from "@/oss/state/entities/trace"
import {projectIdAtom} from "@/oss/state/project"

import {useStyles} from "./assets/styles"
import {Mapping, TestsetColumn, TestsetDrawerProps, TestsetTraceData} from "./assets/types"
import {
    hasDuplicateColumnsAtom,
    hasValidMappingsAtom,
    mappingDataAtom,
    previewKeyAtom,
    selectedRevisionIdAtom as drawerRevisionIdAtom,
    traceDataAtom,
    traceSpanIdsAtom,
} from "./atoms/drawerState"
import {
    clearLocalEntitiesAtom,
    createLocalEntitiesAtom,
    updateAllLocalEntitiesAtom,
} from "./atoms/localEntities"
import {
    cascaderOptionsAtom,
    selectedTestsetIdAtom,
    testsetRevisionsQueryFamily,
    testsetsListQueryAtom,
} from "./atoms/testsetQueries"

const TestsetDrawer = ({
    onClose,
    data,
    showSelectedSpanText = true,
    ...props
}: TestsetDrawerProps) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const projectId = useAtomValue(projectIdAtom)

    // Entity mutations
    const setCurrentRevisionId = useSetAtom(currentRevisionIdAtom)
    const executeAppendTestcases = useSetAtom(appendTestcasesAtom)
    const executeSaveTestset = useSetAtom(saveTestsetAtom)
    const executeAddColumn = useSetAtom(addColumnAtom)

    // Entity-based columns (for selected revision)
    const currentColumns = useAtomValue(currentColumnsAtom)

    // Entity-based testset name query (required for save mutation)
    const _testsetNameQuery = useAtomValue(testsetNameQueryAtom)

    // Drawer state atoms (replacing useState)
    const [mappingData, setMappingData] = useAtom(mappingDataAtom)
    const [traceDataState, setTraceDataState] = useAtom(traceDataAtom)
    const [previewKey, setPreviewKey] = useAtom(previewKeyAtom)
    const [selectedRevisionId, setSelectedRevisionId] = useAtom(drawerRevisionIdAtom)
    const [hasDuplicateColumns, setHasDuplicateColumns] = useAtom(hasDuplicateColumnsAtom)
    const _hasValidMappings = useAtomValue(hasValidMappingsAtom)
    const setTraceSpanIds = useSetAtom(traceSpanIdsAtom)

    // Local entity operations
    const createLocalEntities = useSetAtom(createLocalEntitiesAtom)
    const updateAllLocalEntities = useSetAtom(updateAllLocalEntitiesAtom)
    const clearLocalEntities = useSetAtom(clearLocalEntitiesAtom)

    // Atom-based testset and revision queries
    const testsetsQuery = useAtomValue(testsetsListQueryAtom)
    const [selectedTestsetId, setSelectedTestsetId] = useAtom(selectedTestsetIdAtom)
    const revisionsQuery = useAtomValue(testsetRevisionsQueryFamily(selectedTestsetId))

    // Derived state from queries
    const isTestsetsLoading = testsetsQuery.isPending
    const cascaderBaseOptions = useAtomValue(cascaderOptionsAtom)

    // Helper to format revision labels with metadata (similar to buildRevisionMenuItems)
    const formatRevisionLabel = useCallback((revision: any) => {
        // Normalize author field (API returns created_by_id, entity system uses author)
        const authorId = revision.author ?? revision.created_by_id
        const hasMetadata = revision.created_at || revision.message || authorId

        if (!hasMetadata) {
            // Simple label if no metadata
            return `v${revision.version}`
        }

        // Rich label with metadata
        return (
            <div className="flex flex-col gap-0.5 py-1 max-w-[240px]">
                <div className="flex items-center gap-2">
                    <span className="font-medium">v{revision.version}</span>
                    {revision.created_at && (
                        <Typography.Text type="secondary" className="text-xs">
                            {new Date(revision.created_at).toLocaleDateString()}
                        </Typography.Text>
                    )}
                </div>
                {revision.message && (
                    <Typography.Text
                        type="secondary"
                        className="text-xs truncate max-w-[220px]"
                        title={revision.message}
                    >
                        {revision.message}
                    </Typography.Text>
                )}
                {authorId && (
                    <div className="text-xs">
                        <UserReference userId={authorId} />
                    </div>
                )}
            </div>
        )
    }, [])

    const buildRevisionOption = useCallback(
        (revision: any) => ({
            value: revision.id,
            label: formatRevisionLabel(revision),
            isLeaf: true,
            revisionMeta: revision,
        }),
        [formatRevisionLabel],
    )

    const renderSelectedRevisionLabel = useCallback((labels: string[], selectedOptions?: any[]) => {
        if (!selectedOptions || selectedOptions.length === 0) {
            return labels.join(" / ")
        }

        const baseLabel =
            typeof selectedOptions[0]?.label === "string"
                ? selectedOptions[0].label
                : typeof labels?.[0] === "string"
                  ? labels[0]
                  : "Selected testset"

        const revisionOption = selectedOptions[selectedOptions.length - 1]
        const revisionVersion = revisionOption?.revisionMeta?.version

        if (!revisionVersion) {
            return baseLabel
        }

        return (
            <span className="application-variant-row whitespace-nowrap overflow-hidden text-ellipsis">
                <span className="application-variant-label whitespace-nowrap overflow-hidden text-ellipsis">
                    {baseLabel}{" "}
                    <span className="application-variant-chip">{`v${revisionVersion}`}</span>
                </span>
            </span>
        )
    }, [])

    // Local state declarations (must come before callbacks that use them)
    const [cascaderOptions, setCascaderOptions] = useState<any[]>([])
    const [cascaderValue, setCascaderValue] = useState<string[]>([])
    const [loadingRevisions, setLoadingRevisions] = useState(false)
    const [isDrawerExtended, setIsDrawerExtended] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [updatedTraceData, setUpdatedTraceData] = useState("")
    const [testset, setTestset] = useState({name: "", id: ""})
    const [availableRevisions, setAvailableRevisions] = useState<
        {id: string; version: number | null}[]
    >([])
    const [newTestsetName, setNewTestsetName] = useState("")
    const [editorFormat, setEditorFormat] = useState<"JSON" | "YAML">("JSON")
    const [selectedTestsetColumns, setSelectedTestsetColumns] = useState<TestsetColumn[]>([])
    const [selectedTestsetRows, setSelectedTestsetRows] = useState<KeyValuePair[]>([])
    const [rowDataPreview, setRowDataPreview] = useState(data[0]?.key)
    const [isConfirmSave, setIsConfirmSave] = useState(false)
    const [commitMessage, setCommitMessage] = useState("")

    // traceData is now managed by traceDataAtom
    const traceData = traceDataState

    // Sync base options to cascader options when testsets list changes
    useEffect(() => {
        setCascaderOptions([...cascaderBaseOptions])
    }, [cascaderBaseOptions])

    // Dynamic revision loading for cascader
    const loadRevisions = useCallback(
        async (selectedOptions: any[]) => {
            const targetOption = selectedOptions[selectedOptions.length - 1]
            console.log("🔄 [loadRevisions] Called with:", {
                targetOption,
                value: targetOption?.value,
                selectedOptionsLength: selectedOptions.length,
            })

            if (!targetOption || targetOption.value === "create") {
                console.log("🔄 [loadRevisions] Skipping - no target or create")
                return
            }

            const testsetId = targetOption.value
            setLoadingRevisions(true)

            // Set loading state with new object references
            setCascaderOptions((prev) => {
                console.log("🔄 [loadRevisions] Setting loading state, prev options:", prev.length)
                return prev.map((opt) => (opt.value === testsetId ? {...opt, loading: true} : opt))
            })

            try {
                console.log("🔄 [loadRevisions] Fetching revisions for testsetId:", testsetId)
                const revisions = await fetchTestsetRevisions({testsetId})
                console.log("🔄 [loadRevisions] Got revisions:", revisions)

                // fetchTestsetRevisions already filters out v0, so no need to filter again
                const revisionChildren = revisions.map((rev) => buildRevisionOption(rev))

                console.log("🔄 [loadRevisions] Built revision children:", revisionChildren)

                const children =
                    revisionChildren.length > 0
                        ? revisionChildren
                        : [
                              {
                                  value: "no-revisions",
                                  label: "No revisions available",
                                  disabled: true,
                                  isLeaf: true,
                              },
                          ]

                console.log("🔄 [loadRevisions] Final children to set:", children)

                // Update with new object references
                setCascaderOptions((prev) => {
                    const updated = prev.map((opt) =>
                        opt.value === testsetId ? {...opt, loading: false, children} : opt,
                    )
                    console.log("🔄 [loadRevisions] Updated options:", updated)
                    return updated
                })
            } catch (error) {
                console.error("🔄 [loadRevisions] Error:", error)
                setCascaderOptions((prev) =>
                    prev.map((opt) =>
                        opt.value === testsetId
                            ? {
                                  ...opt,
                                  loading: false,
                                  children: [
                                      {
                                          value: "error",
                                          label: "Failed to load revisions",
                                          disabled: true,
                                          isLeaf: true,
                                      },
                                  ],
                              }
                            : opt,
                    ),
                )
            } finally {
                setLoadingRevisions(false)
            }
        },
        [buildRevisionOption],
    )

    const elemRef = useResizeObserver<HTMLDivElement>((rect) => {
        setIsDrawerExtended(rect.width > 640)
    })

    // Entity-based table for preview (handles both server + local entities)
    // Skip empty revision init - TestsetDrawer manages its own columns via localEntities
    const previewTable = useTestcasesTable({
        revisionId: selectedRevisionId || undefined,
        skipEmptyRevisionInit: true,
    })
    const rowHeight = useRowHeight(testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG)

    const handleDrawerClose = useCallback(() => {
        onClose()
        setUpdatedTraceData("")
        setNewTestsetName("")
        setHasDuplicateColumns(false)
    }, [onClose, setHasDuplicateColumns])

    const hasStructuralDifference = useCallback((trace: TestsetTraceData[]): boolean => {
        if (trace.length <= 1) return false

        const referencePaths = collectKeyPaths(trace[0].data).sort().join(",")

        for (let i = 1; i < trace.length; i++) {
            const currentPaths = collectKeyPaths(trace[i].data).sort().join(",")

            if (currentPaths !== referencePaths) {
                return true
            }
        }
        return false
    }, [])

    const [isDifferStructureExist, setIsDifferStructureExist] = useState(
        hasStructuralDifference(traceData),
    )

    const isNewTestset = testset.id === "create"
    const elementWidth = isDrawerExtended ? 200 * 2 : 200
    const isNewColumnCreated = useMemo(
        () => selectedTestsetColumns.find(({isNew}) => isNew),
        [selectedTestsetColumns],
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
    const selectedTraceData = useMemo(
        () => traceData.find((trace) => trace.key === rowDataPreview),
        [rowDataPreview, traceData],
    )
    const formatDataPreview = useMemo(() => {
        if (!traceData?.length) return ""

        const jsonObject = {data: selectedTraceData?.data || traceData[0]?.data}
        if (!jsonObject) return ""

        return getYamlOrJson(editorFormat, jsonObject)
    }, [editorFormat, traceData, rowDataPreview])

    // Initialize atoms when data prop changes
    useLazyEffect(() => {
        if (data.length > 0) {
            const hasDiffer = hasStructuralDifference(data)
            setIsDifferStructureExist(hasDiffer)

            setTraceDataState(data)
            setRowDataPreview(data[0]?.key)
            setPreviewKey(data[0]?.key || "all")

            // Extract span IDs from trace data for entity cache lookup
            // The key field typically contains the span_id
            const spanIds = data.map((trace) => trace.key).filter(Boolean)
            setTraceSpanIds(spanIds)
        }
    }, [data, setTraceDataState, setPreviewKey, setTraceSpanIds])

    // predefind options
    const customSelectOptions = useCallback((divider = true) => {
        return [
            {value: "create", label: "Create New"},
            ...(divider
                ? [
                      {
                          value: "divider",
                          label: <Divider className="!my-1" />,
                          className: "!p-0 !m-0 !min-h-0.5 !cursor-default",
                          disabled: true,
                      },
                  ]
                : []),
        ]
    }, [])

    // Handler for cascader selection
    const onCascaderChange = useCallback(
        (value: any, selectedOptions: any[]) => {
            if (!value || value.length === 0) {
                return
            }

            resetStates()

            // Handle "Create New" selection
            if (value[0] === "create") {
                setTestset({name: "Create New", id: "create"})
                setSelectedTestsetId("create")
                setSelectedRevisionId("draft")
                setCurrentRevisionId("draft")
                setCascaderValue(["create"])
                return
            }

            // Handle testset selection
            const testsetId = value[0]
            const revisionId = value.length > 1 ? value[1] : null
            const testsetName =
                typeof selectedOptions[0]?.label === "string"
                    ? selectedOptions[0].label
                    : "Selected testset"

            // Set the testset ID to trigger revision query
            setSelectedTestsetId(testsetId)
            setTestset({name: testsetName, id: testsetId})

            if (revisionId) {
                // Revision explicitly selected
                setSelectedRevisionId(revisionId)
                setCurrentRevisionId(revisionId)
                setCascaderValue([testsetId, revisionId])
            } else {
                // Only testset clicked - auto-select latest revision from cascader children
                const testsetOption = selectedOptions[0]
                const revisionChildren = testsetOption?.children || []
                // Find the latest revision (first non-draft revision, or first revision)
                const latestRevision =
                    revisionChildren.find((r: any) => r.value !== "draft") || revisionChildren[0]

                if (latestRevision) {
                    setSelectedRevisionId(latestRevision.value)
                    setCurrentRevisionId(latestRevision.value)
                    setCascaderValue([testsetId, latestRevision.value])
                } else {
                    // Revisions not loaded yet - will be handled by effect after loadRevisions completes
                    setCascaderValue([testsetId])
                }
            }
        },
        [setSelectedTestsetId, setCurrentRevisionId, setSelectedRevisionId],
    )

    // Auto-select latest revision when revisions load and none is selected
    useEffect(() => {
        if (
            selectedTestsetId &&
            selectedTestsetId !== "create" &&
            revisionsQuery.data?.length &&
            !selectedRevisionId
        ) {
            const latestRevision = revisionsQuery.data[0]
            if (latestRevision) {
                setSelectedRevisionId(latestRevision.id)
                setCurrentRevisionId(latestRevision.id)
                setCascaderValue([selectedTestsetId, latestRevision.id])
            }
        }
    }, [
        selectedTestsetId,
        revisionsQuery.data,
        selectedRevisionId,
        setSelectedRevisionId,
        setCurrentRevisionId,
    ])

    // Create local entities when a real revision is selected AND columns are loaded
    // The atom has its own guard to prevent re-creation for the same revision
    // Entities are created WITH mapped data already populated
    useEffect(() => {
        const hasMappings = mappingData.some((m) => m.column || m.newColumn)

        if (
            selectedRevisionId &&
            selectedRevisionId !== "draft" &&
            traceData.length > 0 &&
            currentColumns.length > 0 && // Wait for columns to load
            hasMappings // Wait for mappings to be configured
        ) {
            console.log(
                "🆕 [LocalEntities] Creating local entities for revision:",
                selectedRevisionId,
                "with columns:",
                currentColumns.length,
                "and mappings:",
                mappingData.length,
            )
            // createLocalEntities has internal guard to prevent re-creation
            // Pass mappings so entities are created with data already populated
            createLocalEntities({
                traceData,
                mappings: mappingData,
                getValueAtPath,
            })
        }
    }, [selectedRevisionId, traceData, currentColumns, mappingData, createLocalEntities])

    // Note: Mappings are applied during entity creation in createLocalEntitiesAtom
    // The updateAllLocalEntities is only needed for mapping changes AFTER creation
    // which is handled in onMappingOptionChange

    const onRemoveTraceData = () => {
        const removeTrace = traceData.filter((trace) => trace.key !== rowDataPreview)
        setTraceDataState(removeTrace)

        if (removeTrace.length > 0) {
            const currentIndex = traceData.findIndex((trace) => trace.key === rowDataPreview)
            // [currentIndex]: Next option in list | [currentIndex - 1]: Previous option if next doesn't exist | [0]: Default to first option
            const nextPreview =
                removeTrace[currentIndex] || removeTrace[currentIndex - 1] || removeTrace[0]

            setRowDataPreview(nextPreview.key)

            if (rowDataPreview === previewKey) {
                onPreviewOptionChange(nextPreview.key)
            }
        } else {
            setRowDataPreview("")
        }
    }

    // Collect all available data paths from trace data using entity selectors
    const allAvailablePaths = useMemo(() => {
        const uniquePaths = new Set<string>()

        traceData.forEach((traceItem) => {
            const traceKeys = collectKeyPaths(traceItem?.data, "data")
            traceKeys.forEach((key) => uniquePaths.add(key))
        })

        return pathsToSelectOptions(Array.from(uniquePaths))
    }, [traceData])

    // Track which testset we've auto-mapped for (to prevent re-running on column changes)
    const autoMappedForTestsetRef = useRef<string | null>(null)

    // Auto-detect and map paths when testset is selected (ONCE per testset)
    // Uses entity selectors for path extraction and column matching
    useEffect(() => {
        // Skip if we've already auto-mapped for this testset
        if (autoMappedForTestsetRef.current === testset.id) {
            return
        }

        // Collect all unique paths from trace data
        const uniquePaths = new Set<string>()
        traceData.forEach((traceItem) => {
            const traceKeys = collectKeyPaths(traceItem?.data, "data")
            traceKeys.forEach((key) => uniquePaths.add(key))
        })

        // Filter to only input/output/internals paths using entity selector
        const dataPaths = filterDataPaths(Array.from(uniquePaths))

        if (dataPaths.length > 0 && testset.id) {
            setMappingData((prevMappingData) => {
                // Get all columns (entity columns for existing testsets, local state for new)
                const allColumns = isNewTestset
                    ? selectedTestsetColumns.map((item) => item.column)
                    : currentColumns.map((col) => col.key)

                // Use entity selector to match columns with suggestions
                const matchedMappings = matchColumnsWithSuggestions(
                    dataPaths.map((path) => ({
                        data: path,
                        suggestedColumn: path.split(".").pop()!,
                    })),
                    allColumns,
                )

                // Convert to mapping format
                const newMappedData = matchedMappings.map((match, index) => ({
                    ...prevMappingData[index],
                    data: match.data,
                    column: match.column,
                }))

                // For new testsets, update local column state
                if (isNewTestset) {
                    const testsetColumnsSet = new Set(allColumns.map((col) => col.toLowerCase()))
                    const updatedColumns = new Set([
                        ...allColumns,
                        ...newMappedData
                            .filter((item) => item.column !== "create" && item.column)
                            .map((item) => item.column),
                    ])

                    const nextSelectedColumns = Array.from(updatedColumns).map((column) => ({
                        column,
                        isNew: !testsetColumnsSet.has(column.toLowerCase()),
                    }))

                    setSelectedTestsetColumns((prevColumns) => {
                        const hasSameLength = prevColumns.length === nextSelectedColumns.length
                        const isSameOrder = hasSameLength
                            ? prevColumns.every(
                                  (col, index) =>
                                      col.column === nextSelectedColumns[index].column &&
                                      col.isNew === nextSelectedColumns[index].isNew,
                              )
                            : false

                        return isSameOrder ? prevColumns : nextSelectedColumns
                    })
                }

                const isSameLength = newMappedData.length === prevMappingData.length
                const isSameOrder =
                    isSameLength &&
                    prevMappingData.every((item, index) => {
                        const nextItem = newMappedData[index]
                        if (!nextItem) return false
                        return (
                            item?.data === nextItem.data &&
                            item?.column === nextItem.column &&
                            item?.newColumn === nextItem.newColumn
                        )
                    })

                // Mark that we've auto-mapped for this testset
                autoMappedForTestsetRef.current = testset.id

                return isSameOrder ? prevMappingData : newMappedData
            })
        }
    }, [traceData, testset.id, selectedTestsetColumns, currentColumns, isNewTestset])

    // Sync columns to entity system for new testsets (draft revision)
    useEffect(() => {
        if (isNewTestset && selectedTestsetColumns.length > 0) {
            // Get current entity columns
            const entityColumnKeys = new Set(currentColumns.map((col) => col.key))

            // Add any missing columns to entity system
            selectedTestsetColumns.forEach((col) => {
                if (!entityColumnKeys.has(col.column)) {
                    executeAddColumn(col.column)
                }
            })
        }
    }, [isNewTestset, selectedTestsetColumns, currentColumns, executeAddColumn])

    // Derive column options directly from entity atoms (no intermediate state)
    const columnOptions = useMemo(() => {
        if (isNewTestset) {
            // For new testsets, use local state
            return selectedTestsetColumns?.map(({column}) => ({
                value: column,
                label: column,
            }))
        }

        // For existing testsets, use entity columns directly
        return currentColumns.map((col) => ({
            value: col.key,
            label: col.name,
        }))
    }, [currentColumns, selectedTestsetColumns, isNewTestset])

    const mapAndConvertDataInCsvFormat = useCallback(
        (traceData: TestsetTraceData[], type: "preview" | "export") => {
            console.log(`🔨 [Convert] Starting conversion (type: ${type})`)
            console.log("🔨 [Convert] Input trace data count:", traceData.length)
            console.log("🔨 [Convert] Current mappings:", mappingData)

            // First identify duplicate columns and their data paths
            const duplicateColumnMap = new Map<string, string[]>()
            mappingData.forEach((mapping) => {
                const targetKey =
                    mapping.column === "create" || !mapping.column
                        ? mapping.newColumn
                        : mapping.column

                if (targetKey) {
                    if (!duplicateColumnMap.has(targetKey)) {
                        duplicateColumnMap.set(targetKey, [mapping.data])
                    } else {
                        duplicateColumnMap.get(targetKey)!.push(mapping.data)
                    }
                }
            })

            console.log(
                "🔨 [Convert] Duplicate column map:",
                Object.fromEntries(duplicateColumnMap),
            )

            // Get columns that have duplicate mappings
            const duplicateColumns = new Map(
                Array.from(duplicateColumnMap.entries()).filter(([_, paths]) => paths.length > 1),
            )

            const formattedData = traceData.map((item, itemIdx) => {
                console.log(`🔨 [Convert] Processing trace item ${itemIdx}:`, item)
                const formattedItem: Record<string, any> = {}

                // Handle non-duplicate columns first
                for (const mapping of mappingData) {
                    const targetKey =
                        mapping.column === "create" || !mapping.column
                            ? mapping.newColumn
                            : mapping.column

                    if (!targetKey || duplicateColumns.has(targetKey)) {
                        continue // Skip duplicate columns for now
                    }

                    const value = getValueAtPath(item, mapping.data)
                    console.log(`🔨 [Convert] Mapping "${mapping.data}" -> "${targetKey}":`, value)

                    formattedItem[targetKey] =
                        value === undefined || value === null
                            ? ""
                            : typeof value === "string"
                              ? value
                              : JSON.stringify(value)
                }

                // Handle duplicate columns
                duplicateColumns.forEach((dataPaths, columnName) => {
                    const values = dataPaths
                        .map((path) => {
                            const keys = path.split(".")
                            const value = keys.reduce((acc: any, key) => acc?.[key], item)
                            return value === undefined || value === null
                                ? ""
                                : typeof value === "string"
                                  ? value
                                  : JSON.stringify(value)
                        })
                        .filter((val) => val !== "") // Remove empty values

                    formattedItem[columnName] = values.length > 0 ? values.join(" | ") : ""
                })

                // Add empty values for missing columns
                // For new testsets, use selectedTestsetColumns; for existing, use entity columns
                const columnsToCheck = isNewTestset
                    ? selectedTestsetColumns.map((c) => c.column)
                    : currentColumns.map((c) => c.key)

                for (const column of columnsToCheck) {
                    if (!(column in formattedItem)) {
                        formattedItem[column] = ""
                    }
                }

                console.log(`🔨 [Convert] Formatted item ${itemIdx}:`, formattedItem)
                return formattedItem
            })

            console.log("🔨 [Convert] Total formatted rows:", formattedData.length)
            if (formattedData.length > 0) {
                console.log("🔨 [Convert] Sample formatted row:", formattedData[0])
            }

            if (type === "export" && !isNewTestset) {
                // add all previous testcases
                const allKeys = Array.from(
                    new Set(formattedData.flatMap((item) => Object.keys(item))),
                )

                selectedTestsetRows.forEach((row) => {
                    const formattedRow: Record<string, any> = {}
                    for (const key of allKeys) {
                        formattedRow[key] = row[key] ?? ""
                    }

                    formattedData.push(formattedRow)
                })
            }

            console.log("🔨 [Convert] Returning data with length:", formattedData.length)
            return formattedData
        },
        [mappingData, selectedTestsetColumns, selectedTestsetRows, isNewTestset, currentColumns],
    )

    const onMappingOptionChange = useCallback(
        ({pathName, value, idx}: {pathName: keyof Mapping; value: string; idx: number}) => {
            console.log(`🔧 [Mapping Change] ${pathName} at index ${idx} changed to:`, value)
            setMappingData((prev) => {
                const newData = [...prev]
                newData[idx] = {...newData[idx], [pathName]: value}
                console.log("📝 [Mapping Change] Updated mapping data:", newData)
                return newData
            })

            // Only update local entities when column selection changes (not when typing newColumn name)
            // newColumn updates happen on every keystroke, so we skip those to avoid creating T, Te, Tes columns
            if (pathName === "newColumn") {
                return // Don't update entities while typing - wait for blur/submit
            }

            // Update local entities with new mapping values (if revision is selected)
            if (selectedRevisionId && selectedRevisionId !== "draft") {
                // Use updated mapping data for the update
                setMappingData((currentMappings) => {
                    updateAllLocalEntities({
                        traceData,
                        mappings: currentMappings,
                        getValueAtPath,
                    })
                    return currentMappings // Don't change state, just use it
                })
            }
        },
        [traceData, updateAllLocalEntities, selectedRevisionId],
    )

    // Handler for when user finishes typing a new column name (on blur)
    // This triggers the entity update that was skipped during typing
    const onNewColumnBlur = useCallback(() => {
        if (selectedRevisionId && selectedRevisionId !== "draft") {
            console.log("🔧 [Mapping] New column input blurred, updating entities")
            updateAllLocalEntities({
                traceData,
                mappings: mappingData,
                getValueAtPath,
            })
        }
    }, [selectedRevisionId, traceData, mappingData, updateAllLocalEntities])

    // Handler to update preview selection
    const onPreviewOptionChange = useCallback(
        (value: string) => {
            console.log("🔍 [Preview] Changing preview to:", value)
            setPreviewKey(value)
        },
        [setPreviewKey],
    )

    const resetStates = () => {
        console.log("🔄 [Reset] Resetting drawer state")

        // Clear local entities when resetting
        clearLocalEntities()

        setSelectedTestsetColumns([])
        setSelectedTestsetRows([])
        setMappingData((prev) => prev.map((item) => ({...item, column: "", newColumn: ""})))
        setPreviewKey(traceData[0]?.key || "all")
        setNewTestsetName("")
        setSelectedRevisionId("")
        setAvailableRevisions([])
        console.log("🔄 [Reset] Reset complete")
    }

    const onSaveTestset = useCallback(async () => {
        try {
            setIsLoading(true)

            const newTestsetData = mapAndConvertDataInCsvFormat(traceData, "export")

            if (!projectId) {
                message.error("Missing project information")
                return
            }

            if (isNewTestset) {
                if (!newTestsetName) {
                    message.error("Please add a Testset name before saving it")
                    return
                }

                // Create testset with data directly (gets v0 revision with data)
                const response = await createNewTestset(newTestsetName, newTestsetData)

                if (!response?.data?.revisionId || !response?.data?.testset?.id) {
                    throw new Error("Failed to create testset: no revision ID returned")
                }

                const newTestsetId = response.data.testset.id
                const createdRevisionId = response.data.revisionId

                message.success("Testset created successfully")

                // Update state with the new testset
                setTestset({name: newTestsetName, id: newTestsetId})
                setSelectedRevisionId(createdRevisionId)
                setCurrentRevisionId(createdRevisionId)

                // Load revisions for the new testset
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
            } else {
                // Entity-based save for existing testsets
                if (!testset.id) {
                    message.error("Missing testset information")
                    return
                }

                // 1. Append the new testcases using entity mutation
                const addedCount = executeAppendTestcases(newTestsetData)
                console.log(`Added ${addedCount} testcases to entity state`)

                // 2. Save using entity mutation (creates new revision)
                const result = await executeSaveTestset({
                    projectId,
                    testsetId: testset.id,
                    revisionId: selectedRevisionId,
                    commitMessage: commitMessage || `Added ${traceData.length} span(s) to testset`,
                })

                if (result.success && result.newRevisionId) {
                    message.success(
                        commitMessage
                            ? `Saved with message: "${commitMessage}"`
                            : "Testset updated successfully",
                    )

                    // Reload revisions to show the new one
                    try {
                        const revisions = await fetchTestsetRevisions({testsetId: testset.id})
                        setAvailableRevisions(
                            revisions.map((rev) => ({
                                id: rev.id,
                                version: rev.version != null ? Number(rev.version) : null,
                            })),
                        )

                        // Auto-select the new revision
                        setSelectedRevisionId(result.newRevisionId)

                        // Update current revision ID to the new revision
                        setCurrentRevisionId(result.newRevisionId)
                    } catch (error) {
                        console.error("Failed to reload revisions:", error)
                    }
                } else {
                    throw result.error || new Error("Save failed")
                }
            }

            // Refetch testsets list to include any new testset
            await testsetsQuery.refetch()
            setCommitMessage("") // Clear commit message
            setIsConfirmSave(false)
            handleDrawerClose()
        } catch (error) {
            console.error(error)
            message.error("Something went wrong. Please try again later")
        } finally {
            setIsLoading(false)
        }
    }, [
        mapAndConvertDataInCsvFormat,
        traceData,
        isNewTestset,
        newTestsetName,
        testset.id,
        commitMessage,
        testsetsQuery,
        projectId,
        selectedRevisionId,
        executeAppendTestcases,
        executeSaveTestset,
        setCurrentRevisionId,
        handleDrawerClose,
    ])

    const _hasInvalidColumnMappings = useCallback(() => {
        const columnMappings = new Map<string, Set<string>>() // Map of column name to set of paths

        return mappingData.some((item) => {
            const columnName =
                item.column === "create" || !item.column ? item.newColumn : item.column
            if (!columnName || columnName === "create") return false

            const span = item.data

            if (!columnMappings.has(columnName)) {
                columnMappings.set(columnName, new Set([span]))
                return false
            }

            const existingSpans = columnMappings.get(columnName)!
            if (existingSpans.has(span)) {
                return true
            }

            existingSpans.add(span)
            return false
        })
    }, [mappingData])

    const onSaveEditedTrace = () => {
        if (updatedTraceData && updatedTraceData !== formatDataPreview) {
            try {
                const newTrace = traceData.map((trace) => {
                    if (trace.key === rowDataPreview) {
                        const parsedUpdatedData =
                            typeof updatedTraceData === "string"
                                ? editorFormat === "YAML"
                                    ? yaml.load(updatedTraceData)
                                    : JSON.parse(updatedTraceData)
                                : updatedTraceData

                        const updatedDataString = getYamlOrJson(editorFormat, parsedUpdatedData)
                        const originalDataString = getYamlOrJson(editorFormat, {
                            data: trace.originalData || trace.data,
                        })
                        const isMatchingOriginalData = updatedDataString == originalDataString
                        const isMatchingData =
                            updatedDataString !== getYamlOrJson(editorFormat, {data: trace.data})

                        if (isMatchingOriginalData) {
                            return {
                                ...trace,
                                ...parsedUpdatedData,
                                isEdited: false,
                                originalData: null,
                            }
                        } else {
                            return {
                                ...trace,
                                ...parsedUpdatedData,
                                ...(isMatchingData && !trace.originalData
                                    ? {originalData: trace.data}
                                    : {}),
                                isEdited: true,
                            }
                        }
                    }
                    return trace
                })

                // Only update if there are actual changes
                setTraceDataState((prevTraceData) =>
                    JSON.stringify(prevTraceData) !== JSON.stringify(newTrace)
                        ? newTrace
                        : prevTraceData,
                )
            } catch (error) {
                message.error(
                    editorFormat === "YAML" ? "Invalid YAML format" : "Invalid JSON format",
                )
            }
        }
    }

    return (
        <>
            <GenericDrawer
                {...props}
                destroyOnHidden={false}
                onClose={handleDrawerClose}
                expandable
                initialWidth={640}
                headerExtra="Add to testset"
                footer={
                    <div className="flex justify-end items-center gap-2 py-2 px-3">
                        <Button onClick={handleDrawerClose}>Cancel</Button>
                        <Button
                            type="primary"
                            loading={isLoading || isTestsetsLoading}
                            onClick={() =>
                                !isNewTestset && isNewColumnCreated
                                    ? setIsConfirmSave(true)
                                    : onSaveTestset()
                            }
                            disabled={!testset.name || !isMapColumnExist || hasDuplicateColumns}
                        >
                            Save
                        </Button>
                    </div>
                }
                mainContent={
                    <section ref={elemRef} className="w-full flex flex-col gap-6">
                        {isDifferStructureExist && (
                            <Typography.Text
                                className="mb-1 flex items-center gap-1"
                                type="warning"
                            >
                                <WarningCircle size={16} /> Some of the selected spans have a
                                different structure than the others.
                            </Typography.Text>
                        )}

                        {showSelectedSpanText && (
                            <Typography.Text className={classes.drawerHeading}>
                                Spans selected {traceData.length}
                            </Typography.Text>
                        )}

                        <div className={classes.container}>
                            <Typography.Text className={classes.label}>
                                Testset Revision
                            </Typography.Text>
                            <div className="flex gap-2">
                                <Cascader
                                    showSearch
                                    style={{width: elementWidth}}
                                    placeholder="Select testset (auto-selects latest revision)"
                                    value={cascaderValue}
                                    options={cascaderOptions}
                                    onChange={onCascaderChange}
                                    loadData={loadRevisions}
                                    loading={isTestsetsLoading || loadingRevisions}
                                    changeOnSelect
                                    expandTrigger="hover"
                                    displayRender={renderSelectedRevisionLabel}
                                />
                                {isNewTestset && (
                                    <div className="relative">
                                        <Input
                                            style={{width: elementWidth}}
                                            value={newTestsetName}
                                            onChange={(e) => setNewTestsetName(e.target.value)}
                                            placeholder="Testset name"
                                        />
                                        <PencilSimple
                                            size={14}
                                            className="absolute top-[8px] right-2"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={classes.container}>
                            <Typography.Text className={classes.label}>
                                Data preview
                            </Typography.Text>

                            <div className="flex justify-between items-center mb-2">
                                <Select
                                    style={{width: elementWidth}}
                                    value={rowDataPreview}
                                    onChange={(value) => {
                                        setRowDataPreview(value)
                                        setUpdatedTraceData("")
                                    }}
                                >
                                    {traceData.map((trace) => (
                                        <Select.Option value={trace?.key} key={trace?.key}>
                                            Span {trace.id}{" "}
                                            {trace.isEdited && (
                                                <span className={classes.customTag}>(edited)</span>
                                            )}
                                        </Select.Option>
                                    ))}
                                </Select>
                                <div className="flex justify-between items-center gap-2">
                                    {traceData.length > 1 && (
                                        <Button
                                            variant="text"
                                            color="danger"
                                            icon={<Trash size={14} />}
                                            onClick={onRemoveTraceData}
                                        >
                                            Remove span {selectedTraceData?.id}
                                        </Button>
                                    )}

                                    <Radio.Group
                                        options={[
                                            {label: "JSON", value: "JSON"},
                                            {label: "YAML", value: "YAML"},
                                        ]}
                                        onChange={(e) => setEditorFormat(e.target.value)}
                                        value={editorFormat}
                                        optionType="button"
                                    />
                                    <CopyButton
                                        buttonText=""
                                        icon={true}
                                        text={formatDataPreview}
                                    />
                                </div>
                            </div>
                            <div className="relative">
                                <Editor
                                    className={clsx([
                                        classes.editor,
                                        selectedTraceData?.isEdited && "!border-blue-400",
                                    ])}
                                    height={210}
                                    language={editorFormat.toLowerCase()}
                                    theme={`vs-${appTheme}`}
                                    value={formatDataPreview}
                                    onChange={(value) => setUpdatedTraceData(value as string)}
                                    options={{
                                        wordWrap: "on",
                                        minimap: {enabled: false},
                                        scrollBeyondLastLine: false,
                                        readOnly: false,
                                        lineNumbers: "off",
                                        lineDecorationsWidth: 0,
                                        scrollbar: {
                                            verticalScrollbarSize: 4,
                                            horizontalScrollbarSize: 4,
                                        },
                                    }}
                                />
                                {updatedTraceData && updatedTraceData !== formatDataPreview ? (
                                    <Button
                                        icon={<FloppyDiskBack size={14} />}
                                        className="absolute top-2 right-2"
                                        onClick={onSaveEditedTrace}
                                    />
                                ) : null}
                            </div>
                        </div>

                        <div className={classes.container}>
                            <Typography.Text
                                className={classes.label}
                                type={hasDuplicateColumns ? "danger" : "secondary"}
                            >
                                Mapping
                            </Typography.Text>
                            {hasDuplicateColumns && (
                                <Typography.Text type="danger">
                                    Duplicate columns detected. Ensure each column is unique
                                </Typography.Text>
                            )}

                            {selectedRevisionId && selectedRevisionId !== "draft" ? (
                                <>
                                    <div className="flex flex-col gap-2">
                                        {mappingData.map((mapping, idx) => (
                                            <div
                                                key={`mapping-${idx}-${mapping.data || ""}`}
                                                className="flex gap-2 items-start mb-2"
                                                style={{width: elementWidth}}
                                            >
                                                <AutoComplete
                                                    style={{width: elementWidth}}
                                                    placeholder="Select or type a data path"
                                                    value={mapping.data || undefined}
                                                    onSelect={(value) =>
                                                        onMappingOptionChange({
                                                            pathName: "data",
                                                            value,
                                                            idx,
                                                        })
                                                    }
                                                    onChange={(value) =>
                                                        onMappingOptionChange({
                                                            pathName: "data",
                                                            value,
                                                            idx,
                                                        })
                                                    }
                                                    options={allAvailablePaths}
                                                    filterOption={(inputValue, option) =>
                                                        option!.value
                                                            .toUpperCase()
                                                            .indexOf(inputValue.toUpperCase()) !==
                                                        -1
                                                    }
                                                />
                                                <ArrowRight size={16} />
                                                <div className="flex-1 flex gap-2 items-center">
                                                    <Select
                                                        style={{width: "100%"}}
                                                        placeholder="Select a column"
                                                        value={mapping.column || undefined}
                                                        onChange={(value) =>
                                                            onMappingOptionChange({
                                                                pathName: "column",
                                                                value,
                                                                idx,
                                                            })
                                                        }
                                                        options={[
                                                            ...(testset.id
                                                                ? customSelectOptions(
                                                                      selectedTestsetColumns.length >
                                                                          0,
                                                                  )
                                                                : []),
                                                            ...columnOptions,
                                                        ]}
                                                    />

                                                    {mapping.column === "create" && (
                                                        <AutoComplete
                                                            style={{width: "100%"}}
                                                            value={mapping.newColumn || undefined}
                                                            options={columnOptions}
                                                            onSelect={(value) =>
                                                                onMappingOptionChange({
                                                                    pathName: "newColumn",
                                                                    value,
                                                                    idx,
                                                                })
                                                            }
                                                            onChange={(value) =>
                                                                onMappingOptionChange({
                                                                    pathName: "newColumn",
                                                                    value,
                                                                    idx,
                                                                })
                                                            }
                                                            onBlur={onNewColumnBlur}
                                                            placeholder="Column name"
                                                            filterOption={(inputValue, option) =>
                                                                option!.value
                                                                    .toUpperCase()
                                                                    .indexOf(
                                                                        inputValue.toUpperCase(),
                                                                    ) !== -1
                                                            }
                                                        />
                                                    )}
                                                </div>

                                                <Button
                                                    icon={<Trash />}
                                                    onClick={() =>
                                                        setMappingData(
                                                            mappingData.filter(
                                                                (_, index) => index !== idx,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    <Button
                                        type="dashed"
                                        className="mt-1"
                                        style={{width: elementWidth}}
                                        icon={<Plus />}
                                        onClick={() =>
                                            setMappingData([...mappingData, {data: "", column: ""}])
                                        }
                                    >
                                        Add field
                                    </Button>
                                </>
                            ) : (
                                <Typography.Text type="secondary">
                                    Please select a testset revision to configure mappings
                                </Typography.Text>
                            )}
                        </div>

                        <div className={classes.container}>
                            <Typography.Text className={classes.label}>Preview</Typography.Text>
                            {isMapColumnExist ? (
                                <div>
                                    {selectedRevisionId && selectedRevisionId !== "draft" ? (
                                        <TestcasesTableShell
                                            mode="view"
                                            revisionIdParam={selectedRevisionId}
                                            table={previewTable}
                                            rowHeight={rowHeight}
                                            selectedRowKeys={[]}
                                            onSelectedRowKeysChange={() => {}}
                                            onRowClick={() => {}}
                                            onDeleteSelected={() => {}}
                                            searchTerm=""
                                            onSearchChange={() => {}}
                                            header={null}
                                            actions={null}
                                            hideControls={true}
                                            enableSelection={true}
                                            showRowIndex={true}
                                            autoHeight={true}
                                            disableDeleteAction={true}
                                        />
                                    ) : (
                                        <Typography.Text type="secondary">
                                            Select a testset and configure mappings to preview
                                        </Typography.Text>
                                    )}
                                </div>
                            ) : (
                                <Typography.Text>
                                    Please select testset to view testset preview.
                                </Typography.Text>
                            )}
                        </div>

                        {isConfirmSave && (
                            <Modal
                                open={isConfirmSave}
                                onCancel={() => setIsConfirmSave(false)}
                                title="Save changes to testset"
                                okText={"Confirm"}
                                onOk={() => onSaveTestset()}
                                confirmLoading={isLoading || isTestsetsLoading}
                                zIndex={2000}
                                centered
                            >
                                <div className="flex flex-col gap-4 my-4">
                                    <Typography.Text>
                                        You have created new columns. Do you want to add them to the{" "}
                                        <span className="font-bold">{testset.name}</span> testset?
                                    </Typography.Text>

                                    <div className="flex gap-1">
                                        New columns:{" "}
                                        {JSON.stringify(
                                            selectedTestsetColumns
                                                .filter((item) => item.isNew)
                                                .map((item) => item.column),
                                        )}
                                    </div>

                                    {/* Commit message for new revision */}
                                    {!isNewTestset && (
                                        <div className="flex flex-col gap-2">
                                            <Typography.Text strong>
                                                Commit message (optional):
                                            </Typography.Text>
                                            <Input.TextArea
                                                placeholder="Describe your changes..."
                                                value={commitMessage}
                                                onChange={(e) => setCommitMessage(e.target.value)}
                                                rows={3}
                                                maxLength={500}
                                            />
                                            <Typography.Text type="secondary" className="text-xs">
                                                This will create a new revision (v
                                                {(availableRevisions[0]?.version ?? 0) + 1})
                                            </Typography.Text>
                                        </div>
                                    )}
                                </div>
                            </Modal>
                        )}
                    </section>
                }
            />
        </>
    )
}

export default TestsetDrawer
