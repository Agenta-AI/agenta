import {forwardRef, useCallback, useImperativeHandle, useMemo, useState} from "react"

import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {DrillInContent, type PathItem, type PropertyType} from "@/oss/components/DrillInView"
import {JsonEditorWithLocalState} from "@/oss/components/DrillInView/JsonEditorWithLocalState"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import {
    testcaseEntityAtomFamily,
    updateTestcaseAtom,
} from "@/oss/state/entities/testcase/testcaseEntity"

import {formatForJsonDisplay, parseFromJsonDisplay, type DataType} from "./fieldUtils"

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
    // Values are stored as strings for the editors - objects/arrays are JSON stringified
    const formValues = useMemo(() => {
        if (!testcase) return {}
        const values: Record<string, string> = {}
        columns.forEach((col) => {
            const value = testcase[col.key]
            if (value == null) {
                values[col.key] = ""
            } else if (typeof value === "object") {
                // Objects and arrays need to be JSON stringified
                values[col.key] = JSON.stringify(value, null, 2)
            } else if (typeof value === "string") {
                // Check if string is a stringified JSON - if so, parse and re-stringify for formatting
                try {
                    const parsed = JSON.parse(value)
                    if (typeof parsed === "object" && parsed !== null) {
                        // It's a stringified JSON object/array - format it nicely
                        values[col.key] = JSON.stringify(parsed, null, 2)
                    } else {
                        // It's a JSON primitive (string, number, boolean) - keep as-is
                        values[col.key] = value
                    }
                } catch {
                    // Not valid JSON - keep as plain string
                    values[col.key] = value
                }
            } else {
                values[col.key] = String(value)
            }
        })
        return values
    }, [testcase, columns])

    // Track locked types for fields (to prevent UI switching when content changes)
    const [lockedFieldTypes, setLockedFieldTypes] = useState<Record<string, DataType>>({})

    // Get value at path (for DrillInContent)
    const getValue = useCallback(
        (path: string[]): string => {
            if (path.length === 0) return ""
            const [columnKey, ...nestedPath] = path
            let value: unknown = formValues[columnKey]
            if (value === undefined) return ""

            // Parse the column value
            try {
                value = JSON.parse(String(value))
            } catch {
                // Keep as string
            }

            // Navigate through nested path
            for (const key of nestedPath) {
                if (value === null || value === undefined) return ""
                if (Array.isArray(value)) {
                    const index = parseInt(key, 10)
                    if (isNaN(index) || index < 0 || index >= value.length) return ""
                    value = value[index]
                } else if (typeof value === "object") {
                    value = (value as Record<string, unknown>)[key]
                } else {
                    return ""
                }
            }

            if (value === null || value === undefined) return ""
            if (typeof value === "string") return value
            return JSON.stringify(value, null, 2)
        },
        [formValues],
    )

    // Set value at path (for DrillInContent)
    const setValue = useCallback(
        (path: string[], newValue: unknown) => {
            if (path.length === 0) return
            const [columnKey, ...nestedPath] = path

            if (nestedPath.length === 0) {
                // Direct column update
                updateTestcase({id: testcaseId, updates: {[columnKey]: newValue}})
                return
            }

            // Parse the column value
            let rootValue: unknown
            try {
                rootValue = JSON.parse(formValues[columnKey] || "{}")
            } catch {
                rootValue = {}
            }

            // Parse the new value if it's a string
            let parsedNewValue: unknown = newValue
            if (typeof newValue === "string") {
                try {
                    parsedNewValue = JSON.parse(newValue)
                } catch {
                    // Keep as string
                }
            }

            // Navigate and update
            const updateNested = (obj: unknown, keys: string[], value: unknown): unknown => {
                if (keys.length === 0) return value
                const [key, ...rest] = keys

                if (Array.isArray(obj)) {
                    const index = parseInt(key, 10)
                    const newArr = [...obj]
                    newArr[index] = updateNested(obj[index], rest, value)
                    return newArr
                } else if (typeof obj === "object" && obj !== null) {
                    return {
                        ...(obj as Record<string, unknown>),
                        [key]: updateNested((obj as Record<string, unknown>)[key], rest, value),
                    }
                }
                return value
            }

            const updatedValue = updateNested(rootValue, nestedPath, parsedNewValue)
            updateTestcase({id: testcaseId, updates: {[columnKey]: JSON.stringify(updatedValue)}})
        },
        [formValues, updateTestcase, testcaseId],
    )

    // Get root items (columns)
    const getRootItems = useCallback((): PathItem[] => {
        return columns.map((col) => ({
            key: col.key,
            name: col.name,
            value: formValues[col.key] || "",
            isColumn: true,
        }))
    }, [columns, formValues])

    // Get default value for property type
    const getDefaultValueForType = useCallback((type: PropertyType): unknown => {
        switch (type) {
            case "string":
                return ""
            case "number":
                return 0
            case "boolean":
                return false
            case "object":
                return {}
            case "array":
                return []
            default:
                return ""
        }
    }, [])

    // Derive JSON display value from formValues (for JSON mode)
    const jsonDisplayValue = useMemo(() => formatForJsonDisplay(formValues), [formValues])

    // Handle JSON editor change
    const handleJsonChange = useCallback(
        (value: string) => {
            const parsed = parseFromJsonDisplay(value)
            if (parsed) {
                updateTestcase({id: testcaseId, updates: parsed})
            }
        },
        [updateTestcase, testcaseId],
    )

    // Handle save - no-op since edits are already in entity atom
    const handleSave = useCallback(() => {
        // Edits are already saved to testcaseDraftAtomFamily via updateTestcase
    }, [])

    // Expose save handler to parent via ref
    useImperativeHandle(ref, () => ({handleSave}), [handleSave])

    return (
        <div className="flex flex-col h-full overflow-hidden w-full [&_.agenta-shared-editor]:w-[calc(100%-24px)]">
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {editMode === "fields" ? (
                    <DrillInContent
                        getValue={getValue}
                        setValue={setValue}
                        getRootItems={getRootItems}
                        rootTitle="Root"
                        editable={true}
                        showAddControls={true}
                        showDeleteControls={true}
                        valueMode="string"
                        getDefaultValueForType={getDefaultValueForType}
                        lockedFieldTypes={lockedFieldTypes}
                        onLockedFieldTypesChange={setLockedFieldTypes}
                        headerContent={
                            isNewRow && (
                                <div className="rounded-md bg-green-50 border border-green-200 p-3 mb-4">
                                    <Text type="secondary" className="text-green-700">
                                        This is a new testcase that hasn&apos;t been saved to the server
                                        yet. Fill in the fields below and click &quot;Save Testset&quot; to
                                        persist all changes.
                                    </Text>
                                </div>
                            )
                        }
                    />
                ) : (
                    // JSON mode - single JSON editor using derived value from formValues
                    <div className="w-[calc(100%-32px)] px-4">
                        <JsonEditorWithLocalState
                            editorKey="json-editor"
                            initialValue={jsonDisplayValue}
                            onValidChange={handleJsonChange}
                        />
                    </div>
                )}
            </div>
        </div>
    )
})

TestcaseEditDrawerContent.displayName = "TestcaseEditDrawerContent"

export default TestcaseEditDrawerContent
