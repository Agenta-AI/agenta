import {forwardRef, useCallback, useImperativeHandle, useState} from "react"

import {Typography} from "antd"

import {EntityDualViewEditor, type PropertyType} from "@/oss/components/DrillInView"
import {testcase} from "@/oss/state/entities/testcase"
import type {Column} from "@/oss/state/entities/testcase/columnState"

import {type DataType} from "./fieldUtils"

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
    /** Initial drill-in path (for persistence across navigation) */
    initialPath?: string[]
    /** Callback when drill-in path changes */
    onPathChange?: (path: string[]) => void
}

const TestcaseEditDrawerContent = forwardRef<
    TestcaseEditDrawerContentRef,
    TestcaseEditDrawerContentProps
>(({testcaseId, columns, isNewRow, editMode, onEditModeChange, initialPath, onPathChange}, ref) => {
    // Track locked types for fields (to prevent UI switching when content changes)
    const [lockedFieldTypes, setLockedFieldTypes] = useState<Record<string, DataType>>({})

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

    // Handle save - no-op since edits are already in entity atom
    const handleSave = useCallback(() => {
        // Edits are already saved to testcaseDraftAtomFamily via updateTestcase
    }, [])

    // Expose save handler to parent via ref
    useImperativeHandle(ref, () => ({handleSave}), [handleSave])

    // We know testcase entity has drillIn configured, but TypeScript can't infer this

    const entityWithDrillIn = testcase as any

    return (
        <div className="flex flex-col h-full overflow-hidden w-full [&_.agenta-shared-editor]:w-[calc(100%-24px)]">
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                <EntityDualViewEditor
                    entityId={testcaseId}
                    entity={entityWithDrillIn}
                    columns={columns}
                    editMode={editMode}
                    onEditModeChange={onEditModeChange}
                    editable={true}
                    showAddControls={true}
                    showDeleteControls={true}
                    showDirtyBadge={false} // Parent handles this
                    showRevertButton={false} // Parent handles via Cancel
                    showViewToggle={false} // Parent has its own toggle in header
                    rootTitle="Root"
                    getDefaultValueForType={getDefaultValueForType}
                    lockedFieldTypes={lockedFieldTypes}
                    onLockedFieldTypesChange={setLockedFieldTypes}
                    initialPath={initialPath}
                    onPathChange={onPathChange}
                    headerContent={
                        isNewRow ? (
                            <div className="rounded-md bg-green-50 border border-green-200 p-3 mb-4">
                                <Text type="secondary" className="text-green-700">
                                    This is a new testcase that hasn&apos;t been saved to the server
                                    yet. Fill in the fields below and click &quot;Save Testset&quot;
                                    to persist all changes.
                                </Text>
                            </div>
                        ) : null
                    }
                />
            </div>
        </div>
    )
})

TestcaseEditDrawerContent.displayName = "TestcaseEditDrawerContent"

export default TestcaseEditDrawerContent
