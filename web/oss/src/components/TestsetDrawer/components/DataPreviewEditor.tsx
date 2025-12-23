import {useCallback, useMemo, useRef, useState} from "react"

import {ArrowCounterClockwise, CaretLeft, CaretRight, Trash} from "@phosphor-icons/react"
import {Button, Tooltip, Typography} from "antd"

import {EditorProvider} from "@/oss/components/Editor/Editor"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

import {useStyles} from "../assets/styles"
import {TestsetTraceData} from "../assets/types"

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
}

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
}: DataPreviewEditorProps) {
    const classes = useStyles()
    const lastSavedRef = useRef(formatDataPreview)
    // Counter to force editor remount only on explicit revert (not on every edit)
    const [editorVersion, setEditorVersion] = useState(0)

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

    return (
        <div className={classes.container}>
            <Typography.Text className={classes.label}>Data preview</Typography.Text>

            {/* Spans selected info with navigation */}
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-1">
                    <Button
                        type="text"
                        size="small"
                        icon={<CaretLeft size={14} />}
                        disabled={!canGoPrev}
                        onClick={goToPrev}
                    />
                    <Typography.Text>
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
                    />
                </div>
                <div className="flex items-center gap-2">
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
        </div>
    )
}
