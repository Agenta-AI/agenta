import {useCallback, useMemo, useRef, useState} from "react"

import {
    ArrowCounterClockwise,
    CaretLeft,
    CaretRight,
    Code,
    TreeStructure,
    Trash,
} from "@phosphor-icons/react"
import {Button, Segmented, Tooltip, Typography} from "antd"

import {EditorProvider} from "@/oss/components/Editor/Editor"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

import {useStyles} from "../assets/styles"
import {TestsetTraceData} from "../assets/types"

import TraceDataDrillIn from "./TraceDataDrillIn"

interface DataPreviewEditorProps {
    traceData: TestsetTraceData[]
    rowDataPreview: string
    setRowDataPreview: (value: string) => void
    setUpdatedTraceData: (value: string) => void
    editorFormat: "JSON" | "YAML"
    formatDataPreview: string
    selectedTraceData: TestsetTraceData | undefined
    onRemoveTraceData: () => void
    onSaveEditedTrace: (value?: string) => void
    onRevertEditedTrace: () => void
    /** Column options for mapping dropdown */
    columnOptions?: {value: string; label: string}[]
    /** Callback when user wants to map a field to a column - receives the full data path and selected column */
    onMapToColumn?: (dataPath: string, column: string) => void
    /** Callback when user wants to remove a mapping - receives the full data path */
    onUnmap?: (dataPath: string) => void
    /** Map of data paths to column names (for visual indication and display) */
    mappedPaths?: Map<string, string>
}

type ViewMode = "editor" | "drill-in"

export function DataPreviewEditor({
    traceData,
    rowDataPreview,
    setRowDataPreview,
    setUpdatedTraceData,
    editorFormat,
    formatDataPreview,
    selectedTraceData,
    onRemoveTraceData,
    onSaveEditedTrace,
    onRevertEditedTrace,
    columnOptions,
    onMapToColumn,
    onUnmap,
    mappedPaths,
}: DataPreviewEditorProps) {
    const classes = useStyles()
    const lastSavedRef = useRef(formatDataPreview)
    // Counter to force editor remount only on explicit revert (not on every edit)
    const [editorVersion, setEditorVersion] = useState(0)
    // View mode toggle: editor (JSON/YAML) or drill-in (tree navigation)
    const [viewMode, setViewMode] = useState<ViewMode>("drill-in")

    // Stable initial value - only updates when key changes (trace switch or revert)
    // This prevents cursor position reset during typing
    const editorKey = `editor-${rowDataPreview}-${editorVersion}`
    const stableInitialValueRef = useRef({key: editorKey, value: formatDataPreview})
    if (stableInitialValueRef.current.key !== editorKey) {
        stableInitialValueRef.current = {key: editorKey, value: formatDataPreview}
    }
    const stableInitialValue = stableInitialValueRef.current.value

    // Navigation state
    const currentIndex = useMemo(() => {
        return traceData.findIndex((t) => t.key === rowDataPreview)
    }, [traceData, rowDataPreview])

    const canGoPrev = currentIndex > 0
    const canGoNext = currentIndex < traceData.length - 1

    const goToPrev = useCallback(() => {
        if (canGoPrev) {
            setRowDataPreview(traceData[currentIndex - 1].key)
            setUpdatedTraceData("")
        }
    }, [canGoPrev, currentIndex, traceData, setRowDataPreview, setUpdatedTraceData])

    const goToNext = useCallback(() => {
        if (canGoNext) {
            setRowDataPreview(traceData[currentIndex + 1].key)
            setUpdatedTraceData("")
        }
    }, [canGoNext, currentIndex, traceData, setRowDataPreview, setUpdatedTraceData])

    // Handle editor changes - update local state and trigger save
    const handleEditorChange = useCallback(
        (value: string) => {
            console.log("[DataPreviewEditor] handleEditorChange", {
                value: value?.slice(0, 100),
                lastSaved: lastSavedRef.current?.slice(0, 100),
            })
            setUpdatedTraceData(value)
            // Auto-save when content changes - pass value directly to avoid stale closure
            if (value && value !== lastSavedRef.current) {
                lastSavedRef.current = value
                // Trigger save after a short delay to batch rapid changes
                setTimeout(() => {
                    onSaveEditedTrace(value)
                }, 100)
            }
        },
        [setUpdatedTraceData, onSaveEditedTrace],
    )

    // Handle drill-in data changes
    const handleDrillInDataChange = useCallback(
        (updatedData: Record<string, unknown>) => {
            // Wrap in {data: ...} format to match the expected structure
            const wrappedData = {data: updatedData}
            const jsonValue = JSON.stringify(wrappedData, null, 2)
            setUpdatedTraceData(jsonValue)
            lastSavedRef.current = jsonValue
            onSaveEditedTrace(jsonValue)
        },
        [setUpdatedTraceData, onSaveEditedTrace],
    )

    // Span navigation prefix for breadcrumb
    const spanNavigationPrefix = useMemo(
        () => (
            <div className="flex items-center gap-1 mr-2 pr-2 border-r border-gray-200">
                <Button
                    type="text"
                    size="small"
                    icon={<CaretLeft size={14} />}
                    disabled={!canGoPrev}
                    onClick={goToPrev}
                    className="!px-1"
                />
                <Typography.Text className="text-sm whitespace-nowrap">
                    Span {currentIndex + 1} of {traceData.length}
                    {selectedTraceData?.isEdited && (
                        <span className={classes.customTag}> (edited)</span>
                    )}
                </Typography.Text>
                <Button
                    type="text"
                    size="small"
                    icon={<CaretRight size={14} />}
                    disabled={!canGoNext}
                    onClick={goToNext}
                    className="!px-1"
                />
            </div>
        ),
        [
            canGoPrev,
            canGoNext,
            goToPrev,
            goToNext,
            currentIndex,
            traceData.length,
            selectedTraceData?.isEdited,
            classes.customTag,
        ],
    )

    return (
        <div className={classes.container}>
            <div className="flex justify-between items-center mb-2">
                <Typography.Text className={classes.label}>Data preview</Typography.Text>
                <div className="flex items-center gap-2">
                    <Segmented
                        size="small"
                        value={viewMode}
                        onChange={(value) => setViewMode(value as ViewMode)}
                        options={[
                            {
                                value: "drill-in",
                                icon: <TreeStructure size={14} />,
                            },
                            {
                                value: "editor",
                                icon: <Code size={14} />,
                            },
                        ]}
                    />
                    {selectedTraceData?.isEdited && (
                        <Tooltip title="Revert changes">
                            <Button
                                size="small"
                                type="text"
                                icon={<ArrowCounterClockwise size={14} />}
                                onClick={() => {
                                    onRevertEditedTrace()
                                    setEditorVersion((v) => v + 1) // Force editor remount
                                }}
                            />
                        </Tooltip>
                    )}
                    {traceData.length > 1 && (
                        <Button
                            size="small"
                            variant="text"
                            color="danger"
                            icon={<Trash size={14} />}
                            onClick={onRemoveTraceData}
                        />
                    )}
                </div>
            </div>

            {viewMode === "drill-in" ? (
                <TraceDataDrillIn
                    data={selectedTraceData?.data || {}}
                    title="data"
                    breadcrumbPrefix={spanNavigationPrefix}
                    showBackArrow={false}
                    editable
                    onDataChange={handleDrillInDataChange}
                    columnOptions={columnOptions}
                    onMapToColumn={onMapToColumn}
                    onUnmap={onUnmap}
                    mappedPaths={mappedPaths}
                />
            ) : (
                <EditorProvider
                    key={editorKey}
                    codeOnly
                    language={editorFormat.toLowerCase() as "json" | "yaml"}
                    showToolbar={false}
                >
                    <SharedEditor
                        initialValue={stableInitialValue}
                        handleChange={handleEditorChange}
                        editorType="border"
                        className={selectedTraceData?.isEdited ? "border-blue-400" : ""}
                        disableDebounce
                        noProvider
                        editorProps={{
                            codeOnly: true,
                            language: editorFormat.toLowerCase() as "json" | "yaml",
                            showLineNumbers: false,
                        }}
                    />
                </EditorProvider>
            )}
        </div>
    )
}
