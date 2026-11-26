/**
 * The readable preview of a commit: what each changed row and column looks like before and
 * after, with no row id and no internal field.
 */

import {atom} from "jotai"

import {isInternalDataField} from "../../testcase/core"
import {
    currentRevisionIdAtom,
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    testcaseEntityAtomFamily,
    testcaseHasDraftAtomFamily,
    testcaseIdsAtom,
    testcaseQueryAtomFamily,
} from "../../testcase/state/store"

import {pendingColumnOpsAtomFamily} from "./revisionTableState"

/** One changed row or column. `_type` names the change; the other keys are the row values. */
export type CommitPreviewEntry = {_type: string} & Record<string, unknown>

/** The two sides of the commit preview, in the same order, and the number of changes. */
export interface CommitPreview {
    original: CommitPreviewEntry[]
    modified: CommitPreviewEntry[]
    count: number
}

const userFields = (data: Record<string, unknown> | null | undefined) =>
    Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => !isInternalDataField(key)))

/**
 * The commit preview of the current edit session, or null when nothing changed.
 *
 * Column changes come first: a renamed column shows its old name on the left and its new name
 * on the right, a deleted column its name only on the left and an added column its name only
 * on the right. Then
 * each edited row (its saved values against the values the commit sends), each new row on the
 * right and each deleted row on the left.
 */
export const commitPreviewAtom = atom((get): CommitPreview | null => {
    const revisionId = get(currentRevisionIdAtom)
    const deletedIds = get(deletedEntityIdsAtom)
    const original: CommitPreviewEntry[] = []
    const modified: CommitPreviewEntry[] = []
    let count = 0

    if (revisionId) {
        const ops = get(pendingColumnOpsAtomFamily(revisionId))
        for (const {oldKey, newKey} of ops.rename) {
            original.push({_type: "column renamed", name: oldKey})
            modified.push({_type: "column renamed", name: newKey})
        }
        // Each change has an entry on both sides, so the two sides stay in step.
        for (const name of ops.remove) {
            original.push({_type: "column deleted", name})
            modified.push({_type: "column deleted"})
        }
        for (const name of ops.add) {
            original.push({_type: "column added"})
            modified.push({_type: "column added", name})
        }
        count += ops.rename.length + ops.remove.length + ops.add.length
    }

    for (const id of get(testcaseIdsAtom)) {
        if (deletedIds.has(id) || !get(testcaseHasDraftAtomFamily(id))) continue
        original.push({
            _type: "modified",
            ...userFields(get(testcaseQueryAtomFamily(id)).data?.data),
        })
        modified.push({_type: "modified", ...userFields(get(testcaseEntityAtomFamily(id))?.data)})
        count++
    }
    for (const id of get(newEntityIdsAtom)) {
        modified.push({_type: "added", ...userFields(get(testcaseEntityAtomFamily(id))?.data)})
        count++
    }
    for (const id of deletedIds) {
        original.push({
            _type: "deleted",
            ...userFields(get(testcaseQueryAtomFamily(id)).data?.data),
        })
        count++
    }

    return count > 0 ? {original, modified, count} : null
})
