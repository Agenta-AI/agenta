import {useCallback} from "react"

import {testcaseMolecule, type Column, type Testcase} from "@agenta/entities/testcase"
import {TestcaseDrawer, type TestcaseDrawerContentRenderProps} from "@agenta/entity-ui/testcase"
import {useAtomValue, useSetAtom} from "jotai"

import {TestcaseEditorDrawerContent} from "./TestcaseEditorDrawerContent"

/**
 * The drawer of one testcase, with previous and next over the rows of the grid.
 *
 * "Apply" keeps the edit as an unsaved change; closing with Cancel puts the testcase back as it
 * was when the drawer opened. "Apply and Commit Changes" opens the page's commit step, so the
 * row is saved by the same commit as every other change. `viewOnly` (a reader, or a save that
 * runs) shows the data with no edit control.
 */
export const TestcaseEditorDrawer = ({
    testcaseId,
    testcaseNumber,
    columns,
    viewOnly,
    hasPrevious,
    hasNext,
    onPrevious,
    onNext,
    onClose,
    onOpenCommit,
}: {
    testcaseId: string | null
    testcaseNumber: number | undefined
    columns: Column[]
    viewOnly: boolean
    hasPrevious: boolean
    hasNext: boolean
    onPrevious: () => void
    onNext: () => void
    onClose: () => void
    onOpenCommit: () => void
}) => {
    const id = testcaseId ?? ""
    const isNewRow = id.startsWith("new-")
    const testcase = useAtomValue(testcaseMolecule.atoms.data(id))
    const query = useAtomValue(testcaseMolecule.atoms.query(id))
    const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
    const update = useSetAtom(testcaseMolecule.actions.update)

    const restore = useCallback(
        (start: Testcase) => {
            if (id) update(id, {data: start.data ?? {}})
        },
        [id, update],
    )

    const renderContent = useCallback(
        (props: TestcaseDrawerContentRenderProps) =>
            testcaseId ? (
                <TestcaseEditorDrawerContent
                    key={testcaseId}
                    testcaseId={testcaseId}
                    columns={columns}
                    isNewRow={isNewRow}
                    viewOnly={viewOnly}
                    {...props}
                />
            ) : null,
        [columns, isNewRow, testcaseId, viewOnly],
    )

    return (
        <TestcaseDrawer<Testcase>
            open={testcaseId !== null}
            onClose={onClose}
            testcaseId={testcaseId}
            isNewRow={isNewRow}
            testcaseNumber={testcaseNumber}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={onPrevious}
            onNext={onNext}
            onOpenCommitModal={viewOnly ? undefined : onOpenCommit}
            testcaseData={testcase}
            isLoading={!testcase && !isNewRow && query.isPending}
            isError={!testcase && query.isError}
            errorMessage="Failed to load testcase"
            isDirty={isDirty}
            onRestoreSessionStart={restore}
            renderContent={renderContent}
            viewOnly={viewOnly}
            enableRootViewMode
        />
    )
}
