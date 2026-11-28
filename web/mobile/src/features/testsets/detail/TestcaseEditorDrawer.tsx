import {useCallback, useRef} from "react"

import {testcaseMolecule, type Testcase} from "@agenta/entities/testcase"
import {applyColumnOps, type PendingColumnOps} from "@agenta/entities/testset"
import {TestcaseDrawer, type TestcaseDrawerContentRenderProps} from "@agenta/entity-ui/testcase"
import {useAtomValue, useSetAtom} from "jotai"

import type {FieldColumnActions} from "./fields/FieldMenu"
import {replaceDataUpdate} from "./testcaseDataUpdate"
import {TestcaseEditorDrawerContent} from "./TestcaseEditorDrawerContent"
import {TestcaseQueueButton} from "./TestcaseQueuePicker"

/**
 * The row as it was when the drawer first showed it, with the column changes made since then:
 * Cancel undoes the row's edits, not a column change that reached every row. Each change is
 * applied as the commit applies it.
 */
export const withColumnChanges = (
    data: Record<string, unknown>,
    changes: readonly PendingColumnOps[],
): Record<string, unknown> => changes.reduce((current, ops) => applyColumnOps(current, ops), data)

/**
 * The drawer of one testcase, with previous and next over the rows of the grid.
 *
 * "Apply" keeps the edit as an unsaved change; closing with Cancel puts the testcase back as it
 * was when the drawer opened, and removes a row that "Add row" just made. "Apply and Commit
 * Changes" opens the page's commit step, so the row is saved by the same commit as every other
 * change. `viewOnly` (a reader, or a save that
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
    columnActions,
    onAddColumn,
    columnChanges = [],
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
    /** The field menu's Rename column and Delete column; the page asks before each. */
    columnActions?: (key: string) => FieldColumnActions | null
    onAddColumn?: () => void
    /** The column changes made from the field menu since the drawer opened, one per entry. */
    columnChanges?: readonly PendingColumnOps[]
}) => {
    const id = testcaseId ?? ""
    const isNewRow = id.startsWith("new-")
    const testcase = useAtomValue(testcaseMolecule.atoms.data(id))
    const query = useAtomValue(testcaseMolecule.atoms.query(id))
    const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
    const update = useSetAtom(testcaseMolecule.actions.update)
    const remove = useSetAtom(testcaseMolecule.actions.delete)

    // How many column changes there were when the drawer first showed each row, which is when
    // the drawer takes the row's Cancel snapshot.
    const changesSeen = useRef(new Map<string, number>())
    if (!testcaseId) changesSeen.current.clear()
    else if (!changesSeen.current.has(testcaseId)) {
        changesSeen.current.set(testcaseId, columnChanges.length)
    }
    // Cancel puts the row back as it was when the drawer opened, fields added since included,
    // with the column changes made since then.
    // A row added with "Add row" had no state before the drawer, so Cancel removes it.
    const restore = useCallback(
        (start: Testcase) => {
            if (!id) return
            if (discardOnCancel) remove(id)
            else {
                // Only the changes made after the drawer first showed this row: the snapshot
                // already holds the earlier ones.
                const since = columnChanges.slice(changesSeen.current.get(id) ?? 0)
                const restored = withColumnChanges(start.data ?? {}, since)
                update(id, replaceDataUpdate(testcase?.data ?? {}, restored))
            }
        },
        [columnChanges, discardOnCancel, id, remove, testcase?.data, update],
    )

    const renderContent = useCallback(
        (props: TestcaseDrawerContentRenderProps) =>
            testcaseId ? (
                <TestcaseEditorDrawerContent
                    key={testcaseId}
                    testcaseId={testcaseId}
                    isNewRow={isNewRow}
                    viewOnly={viewOnly}
                    columnActions={viewOnly ? undefined : columnActions}
                    onAddColumn={viewOnly ? undefined : onAddColumn}
                    {...props}
                />
            ) : null,
        [columnActions, isNewRow, onAddColumn, testcaseId, viewOnly],
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
            errorMessage="Failed to load test case"
            isDirty={isDirty}
            onRestoreSessionStart={restore}
            renderContent={renderContent}
            renderAddToQueue={viewOnly ? undefined : renderAddToQueue}
            viewOnly={viewOnly}
            enableRootViewMode
        />
    )
}
