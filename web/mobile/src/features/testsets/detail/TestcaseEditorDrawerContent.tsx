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

    // The editor hands back the whole data it was shown. The internal fields go back unchanged,
    // even when the JSON or YAML view typed a field of the same name.
    const handleChange = useCallback(
        (next: Record<string, unknown>) =>
            update(
                testcaseId,
                replaceDataUpdate(data, {...splitInternalFields(next).value, ...internal}),
            ),
        [testcaseId, update, data, internal],
    )

    return (
        <div
            className={[
                "flex h-full w-full flex-col overflow-hidden [&_.drill-in-breadcrumb]:pl-4 [&_.drill-in-field-content]:px-4 [&_.drill-in-field-content]:pt-2",
                // As in the old app: a text box is as tall as its text (the shared editor theme
                // sets 150px, which this app loads unlayered), and message text uses the normal
                // font, not the code face.
                "[&_.editor-input]:!min-h-[34px]",
                "[&_.editor-input.markdown-view>.editor-code]:![font-family:inherit] [&_.editor-input.markdown-view>.editor-code]:!m-0 [&_.editor-input.markdown-view>.editor-code]:!bg-transparent [&_.editor-input.markdown-view>.editor-code]:!p-0",
            ].join(" ")}
        >
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
                    // Fields follow the test set column order, and change only through the
                    // column actions, as in the old app.
                    fieldOrder="data"
                    fieldControls={false}
                />
            </div>
        </div>
    )
}
