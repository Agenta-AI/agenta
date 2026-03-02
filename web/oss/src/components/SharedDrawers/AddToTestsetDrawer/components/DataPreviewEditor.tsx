import {useCallback, useMemo} from "react"

import {Typography} from "antd"

import {EntityDualViewEditor} from "@/oss/components/DrillInView"
import {traceSpan} from "@/oss/state/entities/trace"

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

export function DataPreviewEditor({
    traceData,
    rowDataPreview,
    setRowDataPreview,
    setUpdatedTraceData,
    onRemoveTraceData,
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
    // Build span select options for multi-item navigation
    const spanItems = useMemo(
        () =>
            traceData.map((trace, index) => ({
                key: trace.key,
                label: `Span ${index + 1}`,
            })),
        [traceData],
    )

    // Handle item change (span selection)
    const handleItemChange = useCallback(
        (id: string) => {
            setRowDataPreview(id)
            setUpdatedTraceData("")
        },
        [setRowDataPreview, setUpdatedTraceData],
    )

    // Type assertion needed because traceSpan.drillIn is optional in the general type,
    // but we know it's configured for the trace entity.
    const entityWithDrillIn = traceSpan as typeof traceSpan & {
        drillIn: NonNullable<typeof traceSpan.drillIn>
    }

    return (
        <div className="flex flex-col gap-1">
            {/* Custom header for the Add to Testset flow */}
            <div className="flex flex-col gap-0.5 mb-1">
                <Typography.Text className="font-medium">2. Map Data Fields</Typography.Text>
                <Typography.Text type="secondary" className="text-xs">
                    Click on any field below to map it to a testset column
                </Typography.Text>
            </div>

            <EntityDualViewEditor
                entityId={rowDataPreview}
                entity={entityWithDrillIn}
                defaultEditMode="fields"
                showViewToggle={false}
                // Multi-span navigation
                items={spanItems}
                selectedItemId={rowDataPreview}
                onItemChange={handleItemChange}
                // Field mapping
                columnOptions={columnOptions}
                onMapToColumn={onMapToColumn}
                onUnmap={onUnmap}
                mappedPaths={mappedPaths}
                // Actions
                showRemoveButton={traceData.length > 1}
                onRemove={onRemoveTraceData}
                onRevert={onRevertEditedTrace}
                showDirtyBadge={true}
                showRevertButton={true}
                // DrillIn config
                editable={true}
                rootTitle="data"
                initialPath={initialPath}
                focusPath={focusPath}
                onFocusPathHandled={onFocusPathHandled}
                onPropertyClick={onPropertyClick}
                // Exclude parameters from the default view - they're not testset-relevant
                excludeKeys={["parameters"]}
            />
        </div>
    )
}
