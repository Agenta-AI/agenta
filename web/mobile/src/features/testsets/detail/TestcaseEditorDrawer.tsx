import {useCallback} from "react"

import {testcaseMolecule, type Testcase} from "@agenta/entities/testcase"
import {TestcaseDrawer, type TestcaseDrawerContentRenderProps} from "@agenta/entity-ui/testcase"
import {useAtomValue, useSetAtom} from "jotai"

import {replaceDataUpdate} from "./testcaseDataUpdate"
import {TestcaseEditorDrawerContent} from "./TestcaseEditorDrawerContent"
import {TestcaseQueueButton} from "./TestcaseQueuePicker"

/**
 * The drawer of one testcase, with previous and next over the rows of the grid.
 *
 * "Apply" keeps the edit as an unsaved change; closing with Cancel puts the testcase back as it
 * was when the drawer opened, and removes a row that "Add row" just made. "Apply and Commit Changes" opens the page's commit step, so the
 * row is saved by the same commit as every other change. `viewOnly` (a reader, or a save that
 * runs) shows the data with no edit control.
 */
export const TestcaseEditorDrawer = ({
    testcaseId,
    testcaseNumber,
    viewOnly,
    hasPrevious,
    hasNext,
    onPrevious,
    onNext,
    onClose,
    onOpenCommit,
    discardOnCancel = false,
}: {
    testcaseId: string | null
    testcaseNumber: number | undefined
    viewOnly: boolean
    hasPrevious: boolean
    hasNext: boolean
    onPrevious: () => void
    onNext: () => void
    onClose: () => void
    onOpenCommit: () => void
    /** The row was just added and never applied: Cancel removes it instead of restoring it. */
    discardOnCancel?: boolean
}) => {
    const id = testcaseId ?? ""
    const isNewRow = id.startsWith("new-")
    const testcase = useAtomValue(testcaseMolecule.atoms.data(id))
    const query = useAtomValue(testcaseMolecule.atoms.query(id))
    const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
    const update = useSetAtom(testcaseMolecule.actions.update)
    const remove = useSetAtom(testcaseMolecule.actions.delete)

    // Cancel puts the row back as it was when the drawer opened, fields added since included.
    // A row added with "Add row" had no state before the drawer, so Cancel removes it.
    const restore = useCallback(
        (start: Testcase) => {
            if (!id) return
            if (discardOnCancel) remove(id)
            else update(id, replaceDataUpdate(testcase?.data ?? {}, start.data ?? {}))
        },
        [discardOnCancel, id, remove, testcase?.data, update],
    )

    const renderContent = useCallback(
        (props: TestcaseDrawerContentRenderProps) =>
            testcaseId ? (
                <TestcaseEditorDrawerContent
                    key={testcaseId}
                    testcaseId={testcaseId}
                    isNewRow={isNewRow}
                    viewOnly={viewOnly}
                    {...props}
                />
            ) : null,
        [isNewRow, testcaseId, viewOnly],
    )

    // A row that is not saved yet gets no item ids, so no button.
    const renderAddToQueue = useCallback(
        (itemIds: string[]) =>
            itemIds.length === 0 ? null : (
                <TestcaseQueueButton label="Add to queue" itemIds={itemIds} />
            ),
        [],
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
            renderAddToQueue={viewOnly ? undefined : renderAddToQueue}
            viewOnly={viewOnly}
            enableRootViewMode
        />
    )
}
