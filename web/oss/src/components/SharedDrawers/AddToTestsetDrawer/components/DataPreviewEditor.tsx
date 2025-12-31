import {useCallback, useMemo, useRef, useState} from "react"

import {ArrowCounterClockwise, Code, TreeStructure, Trash} from "@phosphor-icons/react"
import {Button, Segmented, Select, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {EditorProvider} from "@/oss/components/Editor/Editor"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {traceSpan} from "@/oss/state/entities/trace"

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
    /** Path to focus/navigate to in drill-in view */
    focusPath?: string
    /** Callback when focusPath has been handled */
    onFocusPathHandled?: () => void
    /** Callback when a JSON property key is Cmd/Meta+clicked in editor view (for drill-in navigation) */
    onPropertyClick?: (path: string) => void
    /** Initial path to start navigation at in drill-in view (e.g., "inputs.prompt" or ["inputs", "prompt"]) */
    initialPath?: string | string[]
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
    focusPath,
    onFocusPathHandled,
    onPropertyClick,
    initialPath,
}: DataPreviewEditorProps) {
    const lastSavedRef = useRef(formatDataPreview)
    // Counter to force editor remount only on explicit revert (not on every edit)
    const [editorVersion, setEditorVersion] = useState(0)
    // View mode toggle: editor (JSON/YAML) or drill-in (tree navigation)
    const [viewMode, setViewMode] = useState<ViewMode>("drill-in")

    // Check if current span has unsaved changes (for dirty state indicator)
    const isDirtyAtom = useMemo(
        () => traceSpan.selectors.isDirty(rowDataPreview),
        [rowDataPreview],
    )
    const currentSpanIsDirty = useAtomValue(isDirtyAtom)
    const discardDraft = useSetAtom(traceSpan.actions.discard)

    // Handle property click from JSON editor - switch to drill-in and navigate to path
    const handlePropertyClick = useCallback(
        (path: string) => {
            setViewMode("drill-in")
            onPropertyClick?.(path)
        },
        [onPropertyClick],
    )

    // Stable initial value - only updates when key changes (trace switch or revert)
    // This prevents cursor position reset during typing
    const editorKey = `editor-${rowDataPreview}-${editorVersion}`
    const stableInitialValueRef = useRef({key: editorKey, value: formatDataPreview})
    if (stableInitialValueRef.current.key !== editorKey) {
        stableInitialValueRef.current = {key: editorKey, value: formatDataPreview}
    }
    const stableInitialValue = stableInitialValueRef.current.value

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

    // Build span select options
    // Note: We can't use atoms directly in map because we need the component to be within atom context
    // So we'll use a simpler approach - just show index, and the "edited" badge will appear on the selected one
    const spanSelectOptions = useMemo(
        () =>
            traceData.map((trace, index) => ({
                value: trace.key,
                label: `Span ${index + 1}`,
            })),
        [traceData],
    )

    // Span navigation prefix for breadcrumb - stable to prevent re-renders
    // Dirty indicator moved outside to avoid triggering re-renders on every edit
    const spanNavigationPrefix = useMemo(
        () => (
            <div className="flex items-center">
                <Select
                    size="small"
                    value={rowDataPreview}
                    onChange={(value) => {
                        setRowDataPreview(value)
                        setUpdatedTraceData("")
                    }}
                    options={spanSelectOptions}
                    popupMatchSelectWidth={false}
                />
                {/* Use a slash separator instead of chevron to differentiate from breadcrumb navigation */}
                <span className="text-gray-300 mx-2 text-sm">/</span>
            </div>
        ),
        [rowDataPreview, setRowDataPreview, setUpdatedTraceData, spanSelectOptions],
    )

    return (
        <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
                <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                        <Typography.Text className="font-medium">2. Map Data Fields</Typography.Text>
                        {currentSpanIsDirty && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                                edited
                            </span>
                        )}
                    </div>
                    <Typography.Text type="secondary" className="text-xs">
                        Click on any field below to map it to a testset column
                    </Typography.Text>
                </div>
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
                    {currentSpanIsDirty && (
                        <Tooltip title="Revert changes">
                            <Button
                                size="small"
                                type="text"
                                icon={<ArrowCounterClockwise size={14} />}
                                onClick={() => {
                                    discardDraft(rowDataPreview)
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
                    spanId={rowDataPreview}
                    title="data"
                    breadcrumbPrefix={spanNavigationPrefix}
                    showBackArrow={false}
                    editable
                    columnOptions={columnOptions}
                    onMapToColumn={onMapToColumn}
                    onUnmap={onUnmap}
                    mappedPaths={mappedPaths}
                    focusPath={focusPath}
                    onFocusPathHandled={onFocusPathHandled}
                    onPropertyClick={onPropertyClick}
                    initialPath={initialPath}
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
                        className={currentSpanIsDirty ? "border-blue-400" : ""}
                        disableDebounce
                        noProvider
                        onPropertyClick={handlePropertyClick}
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
