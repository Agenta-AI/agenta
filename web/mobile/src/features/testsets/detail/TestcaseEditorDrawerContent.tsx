import {useCallback, useMemo} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {TestcaseDataEditor, type RootDrawerViewMode} from "@agenta/entity-ui/testcase"
import {useAtomValue, useSetAtom} from "jotai"

import {replaceDataUpdate, splitInternalFields} from "./testcaseDataUpdate"

/**
 * The body of the testcase drawer: the testcase data as a form, JSON or YAML. An edit goes to
 * the unsaved row in the editor state, and the commit saves it with the other changes.
 * A row that is not saved yet carries a note that says so.
 *
 * The editor gets no column list. With one, it shows only those columns (the grid reads them
 * from the first 20 rows), turns null into "" and drops fields added or removed in JSON or YAML.
 * The value here is the row data, less the internal dedup id the API keeps in it: the grid does
 * not show that id either, and an edit puts it back unchanged.
 */
export const TestcaseEditorDrawerContent = ({
    testcaseId,
    isNewRow,
    viewOnly,
    initialPath,
    onPathChange,
    rootViewMode,
    collapseSignal,
}: {
    testcaseId: string
    isNewRow: boolean
    viewOnly: boolean
    initialPath: string[]
    onPathChange: (path: string[]) => void
    rootViewMode: RootDrawerViewMode
    collapseSignal: number
}) => {
    const testcase = useAtomValue(testcaseMolecule.atoms.data(testcaseId))
    const update = useSetAtom(testcaseMolecule.actions.update)
    const data = useMemo(() => testcase?.data ?? {}, [testcase?.data])
    const {value, internal} = useMemo(() => splitInternalFields(data), [data])

    // The editor hands back the whole data it was shown; the internal fields go back unchanged.
    const handleChange = useCallback(
        (next: Record<string, unknown>) =>
            update(testcaseId, replaceDataUpdate(data, {...internal, ...next})),
        [testcaseId, update, data, internal],
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
                    onChange={viewOnly ? undefined : handleChange}
                    mode={viewOnly ? "view" : "edit"}
                    surface="drawer"
                    initialPath={initialPath}
                    onPathChange={onPathChange}
                    features={{typeChips: true, rootViewMode: false, columnMapping: false}}
                    rootViewMode={rootViewMode}
                    collapseSignal={collapseSignal}
                />
            </div>
        </div>
    )
}
