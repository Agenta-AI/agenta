import {useCallback, useMemo} from "react"

import {testcaseMolecule, type Column} from "@agenta/entities/testcase"
import {
    TestcaseDataEditor,
    type RootDrawerViewMode,
    type TestcaseDataEditorColumn,
} from "@agenta/entity-ui/testcase"
import type {PropertyType} from "@agenta/ui/drill-in"
import {useAtomValue, useSetAtom} from "jotai"

const defaultValueForType = (type: PropertyType): unknown => {
    switch (type) {
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
}

/**
 * The body of the testcase drawer: the testcase data as a form, JSON or YAML. An edit goes to
 * the unsaved row in the editor state, and the commit saves it with the other changes.
 * A row that is not saved yet carries a note that says so.
 */
export const TestcaseEditorDrawerContent = ({
    testcaseId,
    columns,
    isNewRow,
    viewOnly,
    initialPath,
    onPathChange,
    rootViewMode,
    collapseSignal,
}: {
    testcaseId: string
    columns: Column[]
    isNewRow: boolean
    viewOnly: boolean
    initialPath: string[]
    onPathChange: (path: string[]) => void
    rootViewMode: RootDrawerViewMode
    collapseSignal: number
}) => {
    const testcase = useAtomValue(testcaseMolecule.atoms.data(testcaseId))
    const update = useSetAtom(testcaseMolecule.actions.update)
    const value = useMemo(() => testcase?.data ?? {}, [testcase?.data])

    const editorColumns = useMemo<TestcaseDataEditorColumn[]>(
        () =>
            columns.map((column) => ({
                key: column.key,
                label: column.label ?? column.key,
                pathMode: column.parentKey ? "nested" : "direct",
            })),
        [columns],
    )

    // The editor hands back the whole testcase. The update merges, so a key the reader removed
    // is sent as undefined, which removes it.
    const handleChange = useCallback(
        (next: Record<string, unknown>) => {
            const removed = Object.keys(value).filter((key) => !(key in next))
            update(testcaseId, {
                data: {...next, ...Object.fromEntries(removed.map((key) => [key, undefined]))},
            })
        },
        [testcaseId, update, value],
    )

    return (
        <div className="flex h-full w-full flex-col overflow-hidden [&_.drill-in-breadcrumb]:pl-4 [&_.drill-in-field-content]:px-4 [&_.drill-in-field-content]:pt-2">
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {isNewRow && rootViewMode === "form" ? (
                    <p className="m-4 mb-0 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
                        This is a new testcase that hasn&apos;t been saved to the server yet. Fill
                        in the fields below and click &quot;Commit&quot; to save all changes.
                    </p>
                ) : null}
                <TestcaseDataEditor
                    value={value}
                    columns={editorColumns}
                    onChange={viewOnly ? undefined : handleChange}
                    mode={viewOnly ? "view" : "edit"}
                    surface="drawer"
                    initialPath={initialPath}
                    onPathChange={onPathChange}
                    features={{typeChips: true, rootViewMode: false, columnMapping: false}}
                    rootViewMode={rootViewMode}
                    collapseSignal={collapseSignal}
                    getDefaultValueForType={defaultValueForType}
                />
            </div>
        </div>
    )
}
