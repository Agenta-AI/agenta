import {useMemo} from "react"

import Editor from "@monaco-editor/react"
import {CaretLeft, CaretRight, FloppyDiskBack, Trash} from "@phosphor-icons/react"
import {Button, Radio, Typography} from "antd"
import clsx from "clsx"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

import {useStyles} from "../assets/styles"
import {TestsetTraceData} from "../assets/types"

interface DataPreviewEditorProps {
    traceData: TestsetTraceData[]
    rowDataPreview: string
    setRowDataPreview: (value: string) => void
    setUpdatedTraceData: (value: string) => void
    editorFormat: "JSON" | "YAML"
    setEditorFormat: (format: "JSON" | "YAML") => void
    formatDataPreview: string
    updatedTraceData: string
    selectedTraceData: TestsetTraceData | undefined
    onRemoveTraceData: () => void
    onSaveEditedTrace: () => void
}

export function DataPreviewEditor({
    traceData,
    rowDataPreview,
    setRowDataPreview,
    setUpdatedTraceData,
    editorFormat,
    setEditorFormat,
    formatDataPreview,
    updatedTraceData,
    selectedTraceData,
    onRemoveTraceData,
    onSaveEditedTrace,
}: DataPreviewEditorProps) {
    const {appTheme} = useAppTheme()
    const classes = useStyles()

    // Navigation state
    const currentIndex = useMemo(() => {
        return traceData.findIndex((t) => t.key === rowDataPreview)
    }, [traceData, rowDataPreview])

    const canGoPrev = currentIndex > 0
    const canGoNext = currentIndex < traceData.length - 1

    const goToPrev = () => {
        if (canGoPrev) {
            setRowDataPreview(traceData[currentIndex - 1].key)
            setUpdatedTraceData("")
        }
    }

    const goToNext = () => {
        if (canGoNext) {
            setRowDataPreview(traceData[currentIndex + 1].key)
            setUpdatedTraceData("")
        }
    }

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
                    {traceData.length > 1 && (
                        <Button
                            size="small"
                            variant="text"
                            color="danger"
                            icon={<Trash size={14} />}
                            onClick={onRemoveTraceData}
                        />
                    )}
                    <Radio.Group
                        size="small"
                        options={[
                            {label: "JSON", value: "JSON"},
                            {label: "YAML", value: "YAML"},
                        ]}
                        onChange={(e) => setEditorFormat(e.target.value)}
                        value={editorFormat}
                        optionType="button"
                    />
                    <CopyButton buttonText="" icon={true} text={formatDataPreview} />
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
    )
}
