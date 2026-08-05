import {useCallback, useMemo} from "react"

import {
    TestcaseDataEditor,
    type RootDrawerViewMode,
    type TestcaseDataEditorColumn,
} from "@agenta/entity-ui/testcase"
import {type PropertyType} from "@agenta/ui/drill-in"
import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {testcase} from "@/oss/state/entities/testcase"
import {isNestedColumn} from "@/oss/state/entities/testcase/columnPathUtils"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import {extractTestcaseUserData} from "@/oss/state/entities/testcase/schema"

const {Text} = Typography

interface TestcaseEditDrawerContentProps {
    /** Testcase ID (reads from draft store) */
    testcaseId: string
    columns: Column[]
    isNewRow: boolean
    /** Initial drill-in path (for persistence across navigation) */
    initialPath?: string[]
    /** Callback when drill-in path changes */
    onPathChange?: (path: string[]) => void
    /** Drawer-owned root view mode (Form / JSON / YAML). */
    rootViewMode?: RootDrawerViewMode
    /** Drawer-owned collapse-all signal. */
    collapseSignal?: number
}

const TestcaseEditDrawerContent = ({
    testcaseId,
    columns,
    isNewRow,
    initialPath,
    onPathChange,
    rootViewMode,
    collapseSignal,
}: TestcaseEditDrawerContentProps) => {
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

    const testcaseEntity = useAtomValue(testcase.selectors.data(testcaseId)) as Record<
        string,
        unknown
    > | null
    const testcaseData = useMemo(
        () => extractTestcaseUserData(testcaseEntity) ?? {},
        [testcaseEntity],
    )
    const dispatch = useSetAtom(testcase.controller(testcaseId))

    const editorColumns = useMemo<TestcaseDataEditorColumn[]>(
        () =>
            columns.map((column) => ({
                key: column.key,
                name: column.name,
                label: column.name ?? column.key,
                pathMode: isNestedColumn(column) ? "nested" : "direct",
            })),
        [columns],
    )

    const handleEditorChange = useCallback(
        (nextValue: Record<string, unknown>) => {
            dispatch({type: "update", changes: nextValue})
        },
        [dispatch],
    )

    const isFormMode = (rootViewMode ?? "form") === "form"

    return (
        <div className="flex flex-col h-full overflow-hidden w-full [&_.drill-in-breadcrumb]:pl-4 [&_.drill-in-field-content]:px-4 [&_.drill-in-field-content]:pt-2">
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {isNewRow && isFormMode ? (
                    <div className="rounded-md bg-green-50 border border-green-200 dark:bg-green-900/25 dark:border-green-800 p-3 m-4 mb-0">
                        <Text type="secondary" className="text-green-700 dark:text-green-300">
                            This is a new testcase that hasn&apos;t been saved to the server yet.
                            Fill in the fields below and click &quot;Save Testset&quot; to persist
                            all changes.
                        </Text>
                    </div>
                ) : null}
                <TestcaseDataEditor
                    value={testcaseData ?? {}}
                    columns={editorColumns}
                    onChange={handleEditorChange}
                    mode="edit"
                    surface="drawer"
                    initialPath={initialPath}
                    onPathChange={onPathChange}
                    features={{
                        typeChips: true,
                        rootViewMode: false,
                        columnMapping: false,
                    }}
                    rootViewMode={rootViewMode ?? "form"}
                    collapseSignal={collapseSignal ?? 0}
                    getDefaultValueForType={getDefaultValueForType}
                />
            </div>
        </div>
    )
}

TestcaseEditDrawerContent.displayName = "TestcaseEditDrawerContent"

export default TestcaseEditDrawerContent
