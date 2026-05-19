import {useCallback, useMemo, useState} from "react"

import {copyToClipboard} from "@agenta/ui"
import {
    DrillInContent,
    DrillInRootToolbar,
    type FieldViewModeOption,
    type PropertyType,
    type RootViewMode,
} from "@agenta/ui/drill-in"
import {TypeChip} from "@agenta/ui/type-chip"

import type {TestcaseDataEditorProps} from "./TestcaseDataEditor.types"
import {
    getTestcasePathValue,
    getTestcaseRootItems,
    normalizeTestcaseData,
    resolveTestcaseEditorFeatures,
    setTestcasePathValue,
} from "./TestcaseDataEditor.utils"
import {TestcaseDrillInFieldRenderer} from "./TestcaseDrillInFieldRenderer"

const DEFAULT_VALUE_BY_TYPE: Record<PropertyType, unknown> = {
    string: "",
    number: 0,
    boolean: false,
    object: {},
    array: [],
}

// Chat-specific view mode and chip variants are scoped for v2.
const TESTCASE_VIEW_OPTIONS: FieldViewModeOption[] = [
    {value: "text", label: "Text"},
    {value: "markdown", label: "Markdown"},
    {value: "json", label: "JSON"},
    {value: "yaml", label: "YAML"},
]

const getTestcaseViewOptions = (): FieldViewModeOption[] => TESTCASE_VIEW_OPTIONS
const renderTestcaseTypeChip = (value: unknown) => <TypeChip value={value} />

export function TestcaseDataEditor({
    value,
    columns,
    onChange,
    mode = "edit",
    surface = "drawer",
    features,
    initialPath,
    onPathChange,
    className,
    label = "Testcase Data",
    headerSlot,
    columnOptions,
    mappedPaths,
    onMapToColumn,
    onUnmap,
    getDefaultValueForType,
}: TestcaseDataEditorProps) {
    const [rootViewMode, setRootViewMode] = useState<RootViewMode>("text")
    const [collapseSignal, setCollapseSignal] = useState(0)

    const handleCollapseAll = useCallback(() => {
        setCollapseSignal((signal) => signal + 1)
    }, [])

    const handleCopy = useCallback(() => {
        if (!value) return
        void copyToClipboard(JSON.stringify(value, null, 2))
    }, [value])

    const resolvedValue = useMemo(() => normalizeTestcaseData(value), [value])
    const resolvedFeatures = useMemo(
        () => resolveTestcaseEditorFeatures(surface, features),
        [surface, features],
    )
    const editable = mode === "edit" && !!onChange

    const getValue = useCallback(
        (path: string[]): unknown => getTestcasePathValue(resolvedValue, path, columns),
        [columns, resolvedValue],
    )

    const setValue = useCallback(
        (path: string[], nextValue: unknown) => {
            if (!editable) return
            onChange?.(setTestcasePathValue(resolvedValue, path, nextValue, columns))
        },
        [columns, editable, onChange, resolvedValue],
    )

    const getRootItems = useCallback(
        () => getTestcaseRootItems(resolvedValue, columns),
        [columns, resolvedValue],
    )

    const defaultValueForType = useCallback(
        (type: PropertyType) => getDefaultValueForType?.(type) ?? DEFAULT_VALUE_BY_TYPE[type] ?? "",
        [getDefaultValueForType],
    )

    return (
        <div className={className}>
            {resolvedFeatures.rootViewMode && (
                <DrillInRootToolbar
                    label={label}
                    headerSlot={headerSlot}
                    viewMode={rootViewMode}
                    onViewModeChange={setRootViewMode}
                    onCollapseAll={handleCollapseAll}
                    onCopy={handleCopy}
                    enableFormView={false}
                />
            )}
            <DrillInContent
                getValue={getValue}
                setValue={setValue}
                getRootItems={getRootItems}
                FieldRenderer={TestcaseDrillInFieldRenderer}
                valueMode="native"
                rootTitle="Root"
                editable={editable}
                showAddControls={editable && !columns?.length}
                showDeleteControls={editable && !columns?.length}
                initialPath={initialPath}
                onPathChange={onPathChange}
                columnOptions={
                    resolvedFeatures.columnMapping && editable ? columnOptions : undefined
                }
                mappedPaths={resolvedFeatures.columnMapping && editable ? mappedPaths : undefined}
                onMapToColumn={
                    resolvedFeatures.columnMapping && editable ? onMapToColumn : undefined
                }
                onUnmap={resolvedFeatures.columnMapping && editable ? onUnmap : undefined}
                getDefaultValueForType={defaultValueForType}
                collapseSignal={collapseSignal}
                viewModeResetSignal={rootViewMode}
                enableFieldViewModes
                showProperties={resolvedFeatures.showProperties}
                getFieldViewModeOptions={getTestcaseViewOptions}
                getDefaultFieldViewMode={({options}) =>
                    options.includes(rootViewMode) ? rootViewMode : (options[0] ?? "json")
                }
                getFieldTypeChip={resolvedFeatures.typeChips ? renderTestcaseTypeChip : undefined}
                hideBreadcrumb={surface === "drawer" || surface === "playground"}
                fieldHeaderVariant="flat"
            />
        </div>
    )
}
