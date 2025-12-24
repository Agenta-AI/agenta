import {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import SimpleDropdownSelect from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/SimpleDropdownSelect"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import {
    testcaseEntityAtomFamily,
    updateTestcaseAtom,
} from "@/oss/state/entities/testcase/testcaseEntity"

import {
    detectDataType,
    canShowTextMode,
    canExpand,
    formatForJsonDisplay,
    parseFromJsonDisplay,
    tryParseAsObject,
    tryParseAsArray,
} from "./fieldUtils"
import TestcaseFieldRenderer, {FieldMode} from "./TestcaseFieldRenderer"

const {Text} = Typography

type EditMode = "fields" | "json"

export interface TestcaseEditDrawerContentRef {
    handleSave: () => void
}

interface TestcaseEditDrawerContentProps {
    /** Testcase ID (reads from draft store) */
    testcaseId: string
    columns: Column[]
    isNewRow: boolean
    onClose: () => void
    editMode: EditMode
    onEditModeChange?: (mode: EditMode) => void
}

const TestcaseEditDrawerContent = forwardRef<
    TestcaseEditDrawerContentRef,
    TestcaseEditDrawerContentProps
>(({testcaseId, columns, isNewRow, editMode}, ref) => {
    // Read testcase from entity atom (same source as cells)
    const testcaseAtom = useMemo(() => testcaseEntityAtomFamily(testcaseId), [testcaseId])
    const testcase = useAtomValue(testcaseAtom)

    // Update testcase (creates draft if needed)
    const updateTestcase = useSetAtom(updateTestcaseAtom)

    // Derive form values from testcase (single source of truth for editing)
    const formValues = useMemo(() => {
        if (!testcase) return {}
        const values: Record<string, string> = {}
        columns.forEach((col) => {
            const value = testcase[col.key]
            values[col.key] = value != null ? String(value) : ""
        })
        return values
    }, [testcase, columns])

    // Per-field mode tracking (text or json or expanded)
    const [fieldModes, setFieldModes] = useState<Record<string, FieldMode>>({})
    // Per-field collapse state
    const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})

    // Initialize field modes when testcase changes (on open or testcase switch)
    useEffect(() => {
        if (!testcase) return
        const initialFieldModes: Record<string, FieldMode> = {}
        columns.forEach((col) => {
            const value = testcase[col.key]
            const stringValue = value != null ? String(value) : ""
            const dataType = detectDataType(stringValue)
            // JSON objects can only be shown in raw mode
            // Strings and messages default to text mode (beautified)
            if (dataType === "json-object") {
                initialFieldModes[col.key] = "raw"
            } else {
                initialFieldModes[col.key] = "text"
            }
        })
        setFieldModes(initialFieldModes)
    }, [testcaseId]) // Only reset when switching to a different testcase

    // Derive JSON display value from formValues (single source of truth)
    const jsonDisplayValue = useMemo(() => formatForJsonDisplay(formValues), [formValues])

    // Handle JSON editor change - update entity (creates draft if needed)
    const handleJsonChange = useCallback(
        (value: string) => {
            const parsed = parseFromJsonDisplay(value)
            if (parsed) {
                updateTestcase({id: testcaseId, updates: parsed})
            }
        },
        [updateTestcase, testcaseId],
    )

    // Handle field change - update entity (creates draft if needed)
    const handleFieldChange = useCallback(
        (columnKey: string, value: string) => {
            updateTestcase({id: testcaseId, updates: {[columnKey]: value}})
        },
        [updateTestcase, testcaseId],
    )

    // Update a nested field within an object
    const handleNestedFieldChange = useCallback(
        (columnKey: string, nestedKey: string, newValue: string) => {
            const currentValue = formValues[columnKey] || "{}"
            const obj = tryParseAsObject(currentValue) || {}

            // Try to parse the new value as JSON, otherwise use as string
            let parsedNewValue: unknown = newValue
            try {
                parsedNewValue = JSON.parse(newValue)
            } catch {
                // Keep as string
            }

            const updatedObj = {...obj, [nestedKey]: parsedNewValue}
            const updatedValue = JSON.stringify(updatedObj)
            updateTestcase({id: testcaseId, updates: {[columnKey]: updatedValue}})
        },
        [formValues, updateTestcase, testcaseId],
    )

    // Update an array item at a specific index
    const handleArrayItemChange = useCallback(
        (columnKey: string, index: number, newValue: string) => {
            const currentValue = formValues[columnKey] || "[]"
            const arr = tryParseAsArray(currentValue) || []

            // Try to parse the new value as JSON, otherwise use as string
            let parsedNewValue: unknown = newValue
            try {
                parsedNewValue = JSON.parse(newValue)
            } catch {
                // Keep as string
            }

            const updatedArr = [...arr]
            updatedArr[index] = parsedNewValue
            const updatedValue = JSON.stringify(updatedArr)
            updateTestcase({id: testcaseId, updates: {[columnKey]: updatedValue}})
        },
        [formValues, updateTestcase, testcaseId],
    )

    // Toggle field collapse state
    const toggleFieldCollapse = useCallback((columnKey: string) => {
        setCollapsedFields((prev) => ({...prev, [columnKey]: !prev[columnKey]}))
    }, [])

    // Get field type dropdown options for SimpleDropdownSelect
    const getFieldTypeOptions = useCallback(
        (columnKey: string) => {
            const currentValue = formValues[columnKey] || ""
            const canText = canShowTextMode(currentValue)
            const expandable = canExpand(currentValue)

            const options = []

            // Text mode only available if not a raw JSON object
            if (canText) {
                options.push({key: "text", value: "text", label: "Text"})
            }

            // Expanded mode available for JSON objects or arrays
            if (expandable) {
                options.push({key: "expanded", value: "expanded", label: "Expanded"})
            }

            // Raw mode always available
            options.push({key: "raw", value: "raw", label: "Raw Data"})

            return options
        },
        [formValues],
    )

    // Set field mode directly
    const setFieldMode = useCallback((columnKey: string, newMode: FieldMode) => {
        setFieldModes((prev) => ({...prev, [columnKey]: newMode}))
    }, [])

    // Get display label for current field mode
    const getFieldModeLabel = useCallback(
        (columnKey: string): string => {
            const mode = fieldModes[columnKey] || "text"
            switch (mode) {
                case "raw":
                    return "Raw Data"
                case "expanded":
                    return "Expanded"
                default:
                    return "Text"
            }
        },
        [fieldModes],
    )

    // Handle save - no-op since edits are already in entity atom
    const handleSave = useCallback(() => {
        // Edits are already saved to testcaseDraftAtomFamily via updateTestcase
        // No additional action needed
    }, [])

    // Expose save handler to parent via ref
    useImperativeHandle(ref, () => ({handleSave}), [handleSave])

    return (
        <div className="flex flex-col h-full overflow-hidden w-full [&_.agenta-shared-editor]:w-[calc(100%-24px)]">
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {isNewRow && (
                    <div className="rounded-md bg-green-50 border border-green-200 p-3 mb-4">
                        <Text type="secondary" className="text-green-700">
                            This is a new testcase that hasn&apos;t been saved to the server yet.
                            Fill in the fields below and click &quot;Save Testset&quot; to persist
                            all changes.
                        </Text>
                    </div>
                )}

                {editMode === "fields" ? (
                    // Fields mode - individual collapsible fields for each column
                    <div className="flex flex-col gap-4">
                        {columns.length === 0 && (
                            <div className="text-gray-500 text-sm">No columns to display</div>
                        )}
                        {columns.map((col) => {
                            const fieldMode = fieldModes[col.key] || "text"
                            const currentValue = formValues[col.key] ?? ""
                            const isCollapsed = collapsedFields[col.key] ?? false

                            return (
                                <div key={col.key} className="flex flex-col gap-2">
                                    {/* Field header - simple row with name and type selector */}
                                    <div className="flex items-center justify-between py-2 px-3 bg-[#FAFAFA] rounded-md border-solid border-[1px] border-[rgba(5,23,41,0.06)]">
                                        <button
                                            type="button"
                                            onClick={() => toggleFieldCollapse(col.key)}
                                            className="flex items-center gap-2 text-left hover:text-gray-700 transition-colors bg-transparent border-none p-0 cursor-pointer"
                                        >
                                            {isCollapsed ? (
                                                <CaretRight size={14} />
                                            ) : (
                                                <CaretDown size={14} />
                                            )}
                                            <span className="text-gray-700">{col.name}</span>
                                        </button>
                                        <SimpleDropdownSelect
                                            value={getFieldModeLabel(col.key)}
                                            options={getFieldTypeOptions(col.key)}
                                            onChange={(value) =>
                                                setFieldMode(col.key, value as FieldMode)
                                            }
                                        />
                                    </div>

                                    {/* Field content - collapsible */}
                                    {!isCollapsed && (
                                        <div className="px-4">
                                            <TestcaseFieldRenderer
                                                columnKey={col.key}
                                                columnName={col.name}
                                                value={currentValue}
                                                fieldMode={fieldMode}
                                                onFieldChange={(value) =>
                                                    handleFieldChange(col.key, value)
                                                }
                                                onNestedFieldChange={(nestedKey, value) =>
                                                    handleNestedFieldChange(
                                                        col.key,
                                                        nestedKey,
                                                        value,
                                                    )
                                                }
                                                onArrayItemChange={(index, value) =>
                                                    handleArrayItemChange(col.key, index, value)
                                                }
                                            />
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    // JSON mode - single JSON editor using derived value from formValues
                    <div className="w-[calc(100%-32px)] px-4">
                        <SharedEditor
                            key="json-editor"
                            initialValue={jsonDisplayValue}
                            handleChange={handleJsonChange}
                            editorType="border"
                            className="min-h-[300px] overflow-hidden"
                            disableDebounce
                            editorProps={{
                                codeOnly: true,
                                language: "json",
                                showLineNumbers: true,
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    )
})

TestcaseEditDrawerContent.displayName = "TestcaseEditDrawerContent"

export default TestcaseEditDrawerContent
