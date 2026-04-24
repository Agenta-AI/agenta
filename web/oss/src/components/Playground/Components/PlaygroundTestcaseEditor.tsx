import {useCallback, useMemo, useState} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController} from "@agenta/playground"
import {VariableControlAdapter} from "@agenta/playground-ui/adapters"
import {HeightCollapse, SyncStateTag, type SyncState} from "@agenta/ui"
import {RightOutlined} from "@ant-design/icons"
import {Code, ListBullets, Plus, Trash, TreeStructure} from "@phosphor-icons/react"
import {Button, Input, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {JsonEditorWithLocalState} from "@/oss/components/DrillInView"
import {AddPropertyForm} from "@/oss/components/DrillInView/AddPropertyForm"

// ============================================================================
// TYPES
// ============================================================================

interface Column {
    key: string
    label?: string
    name?: string
}

interface SuggestedColumn {
    key: string
    label: string
    type: string
}

// ============================================================================
// HELPERS
// ============================================================================

function defaultValueForType(type: string): unknown {
    if (type === "object") return {}
    if (type === "array") return []
    if (type === "number" || type === "integer") return 0
    if (type === "boolean") return false
    return ""
}

/**
 * Extract known sub-paths from a port's synthetic schema.
 * Falls back to `_pathHints` (preserved during grouping) if `properties`
 * isn't populated, so multi-segment sub-paths like `a.b.c` still surface.
 */
function getPortSubPaths(schema: unknown): string[] {
    if (!schema || typeof schema !== "object") return []
    const s = schema as {properties?: Record<string, unknown>; _pathHints?: string[]}
    if (Array.isArray(s._pathHints) && s._pathHints.length > 0) return s._pathHints
    if (s.properties && typeof s.properties === "object") return Object.keys(s.properties)
    return []
}

// ============================================================================
// NESTED FIELD EDITOR (flat view row)
// ============================================================================

interface NestedFieldEditorProps {
    testcaseId: string
    parentKey: string
    subPath: string
    label: string
}

/**
 * A single leaf editor in flat view. Reads/writes a sub-path within a parent
 * cell whose serialized value is a JSON object. Preserves sibling sub-keys
 * on every write — `arda.test254` edit doesn't clobber `arda.test`.
 */
function NestedFieldEditor({testcaseId, parentKey, subPath, label}: NestedFieldEditorProps) {
    const parentRaw = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.testcaseCellValue({
                    testcaseId,
                    column: parentKey,
                }),
            [testcaseId, parentKey],
        ),
    ) as string
    const setCellValue = useSetAtom(executionItemController.actions.setTestcaseCellValue)

    const {value, isParsable} = useMemo(() => {
        if (!parentRaw) return {value: "", isParsable: true}
        try {
            const parsed = JSON.parse(parentRaw) as unknown
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                const raw = (parsed as Record<string, unknown>)[subPath]
                return {value: raw == null ? "" : String(raw), isParsable: true}
            }
            return {value: "", isParsable: false}
        } catch {
            return {value: "", isParsable: false}
        }
    }, [parentRaw, subPath])

    const handleChange = useCallback(
        (nextVal: string) => {
            let parsed: Record<string, unknown> = {}
            if (parentRaw) {
                try {
                    const p = JSON.parse(parentRaw) as unknown
                    if (p && typeof p === "object" && !Array.isArray(p)) {
                        parsed = {...(p as Record<string, unknown>)}
                    }
                } catch {
                    // non-JSON parent — start fresh; overwrite handled by isParsable gate
                }
            }
            parsed[subPath] = nextVal
            setCellValue({
                testcaseId,
                column: parentKey,
                value: JSON.stringify(parsed),
            })
        },
        [parentRaw, parentKey, subPath, setCellValue, testcaseId],
    )

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <Typography.Text className="font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                    {label}
                </Typography.Text>
                {!isParsable && (
                    <Tag
                        color="orange"
                        style={{fontSize: 10, lineHeight: "16px", margin: 0}}
                        title="Parent value is not a JSON object — can't decompose into sub-fields. Switch to hierarchical view to edit."
                    >
                        not an object
                    </Tag>
                )}
            </div>
            <Input
                size="small"
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                disabled={!isParsable}
                placeholder={`Enter ${label}`}
            />
        </div>
    )
}

// ============================================================================
// COMPONENT
// ============================================================================

type EditMode = "fields" | "json"
type FieldView = "hierarchical" | "flat"

/**
 * Playground testcase editor.
 *
 * Renders each *existing* testcase column as a `VariableControlAdapter` row
 * (same component the playground generations panel uses). Prompt-referenced
 * columns that don't yet exist on the testcase are listed separately as
 * "Suggested" — adding them to the testcase is an explicit action, never
 * auto-silent.
 *
 * Why the split: a testcase may legitimately NOT have a field that the
 * prompt references (the value is null / absent for that case). Auto-
 * creating it on prompt edit would conflate "referenced" with "defined"
 * and ship implicit structure. The user decides when a column becomes real.
 */
function PlaygroundTestcaseEditor({testcaseId}: {testcaseId: string}) {
    const [editMode, setEditMode] = useState<EditMode>("fields")
    const [fieldView, setFieldView] = useState<FieldView>("hierarchical")
    const [isOpen, setIsOpen] = useState(true)

    const entityData = useAtomValue(useMemo(() => testcaseMolecule.data(testcaseId), [testcaseId]))
    const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(testcaseId), [testcaseId]))

    const rawColumns = useAtomValue(testcaseMolecule.atoms.columns) as Column[] | null
    const schemaKeys = useAtomValue(executionItemController.selectors.variableKeys) as string[]
    // Friendly name + type map (port key → display label, port type).
    const schemaMap = useAtomValue(executionItemController.selectors.inputPortSchemaMap) as Record<
        string,
        {type: string; name?: string; schema?: unknown}
    >

    const labelFor = useCallback((key: string): string => schemaMap[key]?.name || key, [schemaMap])

    // Existing columns: present in testcase data (or persisted on the entity).
    const existingColumns = useMemo<Column[]>(() => {
        const dataColumns = rawColumns?.filter((col) => col.key !== "testcase_dedup_id") ?? []
        return dataColumns.map((col) => ({...col, label: col.label || labelFor(col.key)}))
    }, [rawColumns, labelFor])

    // Suggested columns: referenced by the prompt but absent from the testcase.
    // Requires explicit Add action — no silent creation.
    const suggestedColumns = useMemo<SuggestedColumn[]>(() => {
        const existingKeys = new Set(existingColumns.map((c) => c.key))
        return schemaKeys
            .filter((key) => !existingKeys.has(key))
            .map((key) => ({
                key,
                label: labelFor(key),
                type: schemaMap[key]?.type ?? "string",
            }))
    }, [existingColumns, schemaKeys, schemaMap, labelFor])

    const jsonValue = useMemo(() => {
        if (!entityData?.data) return "{}"
        if (existingColumns.length > 0) {
            const filtered: Record<string, unknown> = {}
            for (const col of existingColumns) {
                filtered[col.key] = entityData.data[col.key] ?? ""
            }
            return JSON.stringify(filtered, null, 2)
        }
        return JSON.stringify(entityData.data, null, 2)
    }, [entityData, existingColumns])

    const updateTestcase = useSetAtom(testcaseMolecule.actions.update)

    const handleJsonChange = useCallback(
        (value: string) => {
            try {
                const parsed = JSON.parse(value)
                updateTestcase(testcaseId, {data: parsed})
            } catch {
                // Invalid JSON — ignore
            }
        },
        [updateTestcase, testcaseId],
    )

    // Add a user-specified custom property (from AddPropertyForm). No implicit
    // seeding of prompt-referenced keys — those live in the suggested section
    // until the user promotes them explicitly.
    const handleAddProperty = useCallback(
        (name: string, type: string) => {
            const currentData = entityData?.data ?? {}
            if (name in currentData) return
            updateTestcase(testcaseId, {
                data: {...currentData, [name]: defaultValueForType(type)},
            })
        },
        [entityData, testcaseId, updateTestcase],
    )

    // Promote a suggested column (prompt-referenced, absent from testcase) into
    // an existing column by seeding an empty default at its key.
    const handleAddSuggested = useCallback(
        (col: SuggestedColumn) => {
            const currentData = entityData?.data ?? {}
            if (col.key in currentData) return
            updateTestcase(testcaseId, {
                data: {...currentData, [col.key]: defaultValueForType(col.type)},
            })
        },
        [entityData, testcaseId, updateTestcase],
    )

    const handleDeleteColumn = useCallback(
        (columnKey: string) => {
            const currentData = entityData?.data ?? {}
            if (!(columnKey in currentData)) return
            const next: Record<string, unknown> = {...currentData}
            delete next[columnKey]
            updateTestcase(testcaseId, {data: next})
        },
        [entityData, testcaseId, updateTestcase],
    )

    const isNewRow = testcaseId.startsWith("new-") || testcaseId.startsWith("local-")
    const syncState: SyncState = isNewRow ? "new" : isDirty ? "modified" : "unmodified"

    // Any existing column has nested sub-paths → offer the hierarchical/flat
    // toggle. Suppress it when every column is a plain scalar (no point
    // toggling; the two views are identical).
    const hasNestedColumns = useMemo(
        () => existingColumns.some((col) => getPortSubPaths(schemaMap[col.key]?.schema).length > 0),
        [existingColumns, schemaMap],
    )

    const toolbar = useMemo(
        () => (
            <div className="flex items-center gap-1">
                <SyncStateTag syncState={syncState} className="mr-1" />
                {editMode === "fields" && hasNestedColumns && (
                    <>
                        <button
                            type="button"
                            onClick={() => setFieldView("hierarchical")}
                            title="Hierarchical — root fields with JSON editors for objects"
                            className={`flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer transition-colors ${
                                fieldView === "hierarchical"
                                    ? "bg-[rgba(0,0,0,0.06)] text-[#1c2c3d]"
                                    : "bg-transparent text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d]"
                            }`}
                        >
                            <TreeStructure size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setFieldView("flat")}
                            title="Flat — one input per leaf (like a testset table column)"
                            className={`flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer transition-colors ${
                                fieldView === "flat"
                                    ? "bg-[rgba(0,0,0,0.06)] text-[#1c2c3d]"
                                    : "bg-transparent text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d]"
                            }`}
                        >
                            <ListBullets size={14} />
                        </button>
                        <div className="w-px h-4 bg-[rgba(0,0,0,0.08)] mx-1" />
                    </>
                )}
                <button
                    type="button"
                    onClick={() => setEditMode("fields")}
                    title="Fields"
                    className={`flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer transition-colors ${
                        editMode === "fields"
                            ? "bg-[rgba(0,0,0,0.06)] text-[#1c2c3d]"
                            : "bg-transparent text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d]"
                    }`}
                >
                    <TreeStructure size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => setEditMode("json")}
                    title="JSON"
                    className={`flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer transition-colors ${
                        editMode === "json"
                            ? "bg-[rgba(0,0,0,0.06)] text-[#1c2c3d]"
                            : "bg-transparent text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d]"
                    }`}
                >
                    <Code size={14} />
                </button>
            </div>
        ),
        [syncState, editMode, fieldView, hasNestedColumns],
    )

    return (
        <div>
            {/* Header */}
            <div
                className="flex items-center cursor-pointer select-none bg-[#FAFAFA] rounded-md border border-solid border-[rgba(5,23,41,0.06)]"
                style={{padding: "10px 16px", lineHeight: 1.6667}}
                onClick={() => setIsOpen((v) => !v)}
            >
                <span
                    className="flex items-center justify-center transition-transform duration-300"
                    style={{
                        height: 22,
                        marginInlineEnd: 8,
                        fontSize: 12,
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                >
                    <RightOutlined />
                </span>
                <div className="flex-1 flex items-center gap-0 min-w-0">
                    <span style={{fontSize: 12, color: "#1c2c3d", lineHeight: 1.6667}}>
                        Testcase Data
                    </span>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {editMode === "fields" && (
                        <AddPropertyForm onAdd={handleAddProperty} mode="popover" />
                    )}
                    {toolbar}
                </div>
            </div>

            {/* Collapsible content */}
            <HeightCollapse open={isOpen}>
                <div className="px-4 pb-3">
                    {editMode === "fields" ? (
                        <div className="flex flex-col gap-3 pt-3">
                            {existingColumns.length > 0 ? (
                                existingColumns.map((col) => {
                                    const subPaths =
                                        fieldView === "flat"
                                            ? getPortSubPaths(schemaMap[col.key]?.schema)
                                            : []

                                    // Flat view: object-typed columns decompose into
                                    // one row per leaf; scalar columns still render
                                    // as a single VariableControlAdapter.
                                    if (fieldView === "flat" && subPaths.length > 0) {
                                        return (
                                            <div
                                                key={col.key}
                                                className="flex flex-col gap-2 px-3 py-2 rounded border border-solid border-[rgba(5,23,41,0.06)] bg-white"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <Typography.Text
                                                        type="secondary"
                                                        className="text-xs uppercase tracking-wide"
                                                        title={col.key}
                                                    >
                                                        {col.label || col.key}
                                                    </Typography.Text>
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<Trash size={14} />}
                                                        onClick={() => handleDeleteColumn(col.key)}
                                                        aria-label={`Remove ${
                                                            col.label || col.key
                                                        }`}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-2 pl-2">
                                                    {subPaths.map((sp) => (
                                                        <NestedFieldEditor
                                                            key={`${col.key}::${sp}`}
                                                            testcaseId={testcaseId}
                                                            parentKey={col.key}
                                                            subPath={sp}
                                                            label={`${col.label || col.key}.${sp}`}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    }

                                    return (
                                        <VariableControlAdapter
                                            key={col.key}
                                            rowId={testcaseId}
                                            variableKey={col.key}
                                            entityId={testcaseId}
                                            headerActions={
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<Trash size={14} />}
                                                    onClick={() => handleDeleteColumn(col.key)}
                                                    aria-label={`Remove ${col.label || col.key}`}
                                                />
                                            }
                                        />
                                    )
                                })
                            ) : suggestedColumns.length === 0 ? (
                                <div className="text-xs text-[rgba(0,0,0,0.45)] py-4 text-center">
                                    No variables yet. Add a field or reference one from the prompt
                                    using <code>{`{{ name }}`}</code>.
                                </div>
                            ) : null}

                            {suggestedColumns.length > 0 && (
                                <div className="flex flex-col gap-2 pt-1">
                                    <div className="flex items-center gap-2">
                                        <Typography.Text
                                            type="secondary"
                                            className="text-xs uppercase tracking-wide"
                                        >
                                            Suggested from prompt
                                        </Typography.Text>
                                        <Typography.Text
                                            type="secondary"
                                            className="text-xs"
                                            style={{fontSize: 11}}
                                        >
                                            Referenced by the prompt, not yet in this testcase.
                                            Missing is OK — values default to absent.
                                        </Typography.Text>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        {suggestedColumns.map((col) => (
                                            <div
                                                key={col.key}
                                                className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-dashed border-[rgba(5,23,41,0.15)] bg-[rgba(5,23,41,0.02)]"
                                            >
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <Typography.Text
                                                        className="font-[500] text-[12px] leading-[20px] text-[#758391] font-mono truncate"
                                                        title={col.key}
                                                    >
                                                        {col.label}
                                                    </Typography.Text>
                                                    <Tag
                                                        style={{
                                                            fontSize: 10,
                                                            lineHeight: "16px",
                                                            margin: 0,
                                                        }}
                                                    >
                                                        new
                                                    </Tag>
                                                </div>
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<Plus size={14} />}
                                                    onClick={() => handleAddSuggested(col)}
                                                >
                                                    Add
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div
                            className={
                                syncState === "modified"
                                    ? "[&_.agenta-shared-editor]:border-blue-400"
                                    : ""
                            }
                        >
                            <JsonEditorWithLocalState
                                editorKey={`focus-testcase-${testcaseId}-json`}
                                initialValue={jsonValue}
                                onValidChange={handleJsonChange}
                            />
                        </div>
                    )}
                </div>
            </HeightCollapse>
        </div>
    )
}

export default PlaygroundTestcaseEditor
