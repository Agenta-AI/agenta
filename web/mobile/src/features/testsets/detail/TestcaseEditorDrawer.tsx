import {useCallback} from "react"

import {testcaseMolecule, type Testcase} from "@agenta/entities/testcase"
import {TestcaseDrawer, type TestcaseDrawerContentRenderProps} from "@agenta/entity-ui/testcase"
import {useAtomValue, useSetAtom} from "jotai"

import type {FieldColumnActions} from "./fields/TestcaseFieldForm"
import {replaceDataUpdate} from "./testcaseDataUpdate"
import {TestcaseEditorDrawerContent} from "./TestcaseEditorDrawerContent"
import {TestcaseQueueButton} from "./TestcaseQueuePicker"

/** A column change made from the drawer's field menu while the drawer is open. */
export type DrawerColumnChange =
    | {kind: "add"; key: string}
    | {kind: "rename"; from: string; to: string}
    | {kind: "delete"; keys: string[]}

/**
 * The row as it was when the drawer opened, with the column changes made since then: Cancel
 * undoes the row's edits, not a column change that reached every row. A change the snapshot
 * already holds (it was taken after the change) leaves it as it is. A new column is empty, as
 * the commit sends it.
 */
export const withColumnChanges = (
    data: Record<string, unknown>,
    changes: readonly DrawerColumnChange[],
): Record<string, unknown> =>
    changes.reduce<Record<string, unknown>>((current, change) => {
        if (change.kind === "add") {
            return Object.hasOwn(current, change.key) ? current : {...current, [change.key]: ""}
        }
        if (change.kind === "delete") {
            return Object.fromEntries(
                Object.entries(current).filter(([key]) => !change.keys.includes(key)),
            )
        }
        if (!Object.hasOwn(current, change.from) || Object.hasOwn(current, change.to)) {
            return current
        }
        return Object.fromEntries(
            Object.entries(current).map(([key, value]) => [
                key === change.from ? change.to : key,
                value,
            ]),
        )
    }, data)

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
    /** The column changes made from the field menu since the drawer opened. */
    columnChanges?: readonly DrawerColumnChange[]
}) => {
    const id = testcaseId ?? ""
    const isNewRow = id.startsWith("new-")
    const testcase = useAtomValue(testcaseMolecule.atoms.data(id))
    const query = useAtomValue(testcaseMolecule.atoms.query(id))
    const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
    const update = useSetAtom(testcaseMolecule.actions.update)
    const remove = useSetAtom(testcaseMolecule.actions.delete)

    // Cancel puts the row back as it was when the drawer opened, fields added since included,
    // with the column changes made since then.
    // A row added with "Add row" had no state before the drawer, so Cancel removes it.
    const restore = useCallback(
        (start: Testcase) => {
            if (!id) return
            if (discardOnCancel) remove(id)
            else {
                const restored = withColumnChanges(start.data ?? {}, columnChanges)
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
