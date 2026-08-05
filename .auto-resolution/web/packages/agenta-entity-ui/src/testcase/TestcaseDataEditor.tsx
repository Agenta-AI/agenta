import {useCallback, useMemo, useState} from "react"

import {copyToClipboard} from "@agenta/ui"
import {
    DrillInContent,
    DrillInRootToolbar,
    JsonEditorWithLocalState,
    type DataType,
    type FieldViewModeOption,
    type PropertyType,
    type RootViewMode,
} from "@agenta/ui/drill-in"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import deepEqual from "fast-deep-equal"

import {parseCodeString, toCodeString, type RootDrawerViewMode} from "./codeFormat"
import type {TestcaseDataEditorColumn, TestcaseDataEditorProps} from "./TestcaseDataEditor.types"
import {
    buildTestcaseCodeEditorValue,
    getTestcasePathValue,
    getTestcaseRootItems,
    mergeTestcaseCodeEditorValue,
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

// Messages render as a schema-aware form, so Text/Markdown collapse to the
// same view and are misleading. Surface only Form / JSON / YAML.
const MESSAGES_VIEW_OPTIONS: FieldViewModeOption[] = [
    {value: "form", label: "Form"},
    {value: "json", label: "JSON"},
    {value: "yaml", label: "YAML"},
]

const getTestcaseViewOptions = ({dataType}: {dataType: DataType}): FieldViewModeOption[] =>
    dataType === "messages" ? MESSAGES_VIEW_OPTIONS : TESTCASE_VIEW_OPTIONS
const renderTestcaseTypeChip = (value: unknown) => <TypeChip value={value} />

function FullPayloadCodeEditor({
    value,
    onChange,
    format,
    editable,
    columns,
}: {
    value: Record<string, unknown>
    onChange?: (next: Record<string, unknown>) => void
    format: "json" | "yaml"
    editable: boolean
    columns?: TestcaseDataEditorColumn[]
}) {
    // When data columns are provided, scope the JSON/YAML view to just those
    // columns. The full flattened entity also contains system fields like
    // `tags`, `flags`, `meta`, `created_at` etc. — surfacing them here lets the
    // user accidentally overwrite a system record with a primitive (testset
    // commit then fails zod validation). On change, merge edits back over the
    // original value so system fields survive.
    const editableValue = useMemo(() => {
        return buildTestcaseCodeEditorValue(value, columns)
    }, [columns, value])

    const displayValue = useMemo(() => toCodeString(editableValue, format), [editableValue, format])
    const editorId = `testcase-root-${format}-editor`

    const handleChange = useCallback(
        (next: string) => {
            if (!editable || !onChange) return
            const parsed = parseCodeString<unknown>(next, format, editableValue)
            if (parsed === editableValue) return
            const parsedRecord = normalizeTestcaseData(parsed as Record<string, unknown>)
            if (deepEqual(parsedRecord, editableValue)) return
            onChange(mergeTestcaseCodeEditorValue(value, parsedRecord, columns))
        },
        [columns, editable, editableValue, format, onChange, value],
    )

    if (format === "json") {
        return (
            <div className="px-6 py-4">
                <JsonEditorWithLocalState
                    editorKey={editorId}
                    initialValue={displayValue}
                    onValidChange={handleChange}
                    readOnly={!editable}
                />
            </div>
        )
    }

    return (
        <div className="px-6 py-4">
            <EditorProvider
                key={`${editorId}-provider`}
                id={editorId}
                initialValue={displayValue}
                showToolbar={false}
                codeOnly
                language="yaml"
            >
                <SharedEditor
                    id={editorId}
                    initialValue={displayValue}
                    value={displayValue}
                    handleChange={editable ? handleChange : undefined}
                    editorType="border"
                    className="min-h-[200px] overflow-hidden"
                    disableDebounce
                    noProvider
                    disabled={!editable}
                    state={editable ? undefined : "readOnly"}
                    editorProps={{
                        codeOnly: true,
                        language: "yaml",
                        showLineNumbers: true,
                        disableLongText: true,
                    }}
                />
            </EditorProvider>
        </div>
    )
}

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
    rootViewMode: controlledRootViewMode,
    collapseSignal: controlledCollapseSignal,
}: TestcaseDataEditorProps) {
    const isRootViewControlled = controlledRootViewMode !== undefined
    const [uncontrolledRootViewMode, setUncontrolledRootViewMode] = useState<RootViewMode>("text")
    const [uncontrolledCollapseSignal, setUncontrolledCollapseSignal] = useState(0)

    const handleCollapseAll = useCallback(() => {
        setUncontrolledCollapseSignal((signal) => signal + 1)
    }, [])

    const handleCopy = useCallback(() => {
        if (value === undefined) return
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

    // When controlled by a parent (drawer), the root view drives the body
    // between Form / JSON / YAML and we render the toolbar in the drawer
    // header instead of inline. In uncontrolled mode the in-body toolbar
    // keeps its legacy Text/Markdown/JSON/YAML semantics.
    const activeRootViewMode: RootDrawerViewMode | RootViewMode = isRootViewControlled
        ? controlledRootViewMode
        : uncontrolledRootViewMode

    const isFullPayloadCodeView =
        isRootViewControlled &&
        (controlledRootViewMode === "json" || controlledRootViewMode === "yaml")

    if (isFullPayloadCodeView) {
        return (
            <div className={className}>
                <FullPayloadCodeEditor
                    value={resolvedValue}
                    onChange={editable ? onChange : undefined}
                    format={controlledRootViewMode as "json" | "yaml"}
                    editable={editable}
                    columns={columns}
                />
            </div>
        )
    }

    const collapseSignal = isRootViewControlled
        ? (controlledCollapseSignal ?? 0)
        : uncontrolledCollapseSignal

    return (
        <div className={className}>
            {!isRootViewControlled && resolvedFeatures.rootViewMode && (
                <DrillInRootToolbar
                    label={label}
                    headerSlot={headerSlot}
                    viewMode={activeRootViewMode as RootViewMode}
                    onViewModeChange={setUncontrolledRootViewMode}
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
                viewModeResetSignal={
                    isRootViewControlled ? undefined : (activeRootViewMode as RootViewMode)
                }
                enableFieldViewModes
                showProperties={resolvedFeatures.showProperties}
                getFieldViewModeOptions={getTestcaseViewOptions}
                getDefaultFieldViewMode={({options, dataType}) => {
                    if (isRootViewControlled) {
                        if (dataType === "json-object" || dataType === "json-array") return "json"
                        return options[0] ?? "json"
                    }
                    return options.includes(activeRootViewMode as RootViewMode)
                        ? (activeRootViewMode as RootViewMode)
                        : (options[0] ?? "json")
                }}
                getFieldTypeChip={resolvedFeatures.typeChips ? renderTestcaseTypeChip : undefined}
                hideBreadcrumb={surface === "drawer" || surface === "playground"}
                fieldHeaderVariant="flat"
            />
        </div>
    )
}
