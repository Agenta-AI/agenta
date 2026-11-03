import {useMemo} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {revisionMolecule} from "@agenta/entities/testset"
import {atom, useAtomValue} from "jotai"

/** What the commit dialog's preview compares: the test set before and after the changes. */
export interface ChangesDiff {
    original: Record<string, unknown>
    modified: Record<string, unknown>
    /** Rows and columns that differ; the preview heading shows it. */
    count: number
}

interface DiffInput {
    updated: {id: string; before: unknown; after: unknown}[]
    added: {id: string; after: unknown}[]
    deleted: {id: string; before: unknown}[]
    columns: {
        added: string[]
        removed: string[]
        renamed: {oldKey: string; newKey: string}[]
    }
}

/** Builds the two sides of the preview. Pure, so a test can read it without any state. */
export function buildChangesDiff(input: DiffInput): ChangesDiff | null {
    const {updated, added, deleted, columns} = input
    const count =
        updated.length +
        added.length +
        deleted.length +
        columns.added.length +
        columns.removed.length +
        columns.renamed.length
    if (count === 0) return null

    const original: Record<string, unknown> = {}
    const modified: Record<string, unknown> = {}

    const originalRows: Record<string, unknown> = {}
    const modifiedRows: Record<string, unknown> = {}
    for (const row of updated) {
        originalRows[row.id] = row.before
        modifiedRows[row.id] = row.after
    }
    for (const row of deleted) originalRows[row.id] = row.before
    added.forEach((row, index) => {
        modifiedRows[`new row ${index + 1}`] = row.after
    })
    if (Object.keys(originalRows).length > 0) original.rows = originalRows
    if (Object.keys(modifiedRows).length > 0) modified.rows = modifiedRows

    const originalColumns = [...columns.renamed.map((rename) => rename.oldKey), ...columns.removed]
    const modifiedColumns = [...columns.renamed.map((rename) => rename.newKey), ...columns.added]
    if (originalColumns.length > 0) original.columns = originalColumns
    if (modifiedColumns.length > 0) modified.columns = modifiedColumns

    return {original, modified, count}
}

const NO_DIFF = atom<ChangesDiff | null>(null)

/**
 * The preview for the commit dialog. It reads the edit session of `routeId` only while
 * `enabled` is true, so a closed dialog costs nothing.
 */
export function useChangesDiff(routeId: string, enabled: boolean): ChangesDiff | null {
    const diffAtom = useMemo(
        () =>
            enabled
                ? atom((get): ChangesDiff | null => {
                      const serverIds = get(testcaseMolecule.ids)
                      const deletedIds = get(testcaseMolecule.deletedIds)
                      const columns = get(revisionMolecule.atoms.pendingColumnOps(routeId))
                      return buildChangesDiff({
                          updated: serverIds
                              .filter((id) => !deletedIds.has(id))
                              .filter((id) => get(testcaseMolecule.isDirty(id)))
                              .map((id) => ({
                                  id,
                                  before: get(testcaseMolecule.query(id)).data?.data ?? null,
                                  after: get(testcaseMolecule.atoms.draft(id))?.data ?? null,
                              })),
                          added: get(testcaseMolecule.newIds).map((id) => ({
                              id,
                              after: get(testcaseMolecule.atoms.draft(id))?.data ?? null,
                          })),
                          deleted: [...deletedIds].map((id) => ({
                              id,
                              before: get(testcaseMolecule.query(id)).data?.data ?? null,
                          })),
                          columns: {
                              added: columns.add,
                              removed: columns.remove,
                              renamed: columns.rename,
                          },
                      })
                  })
                : NO_DIFF,
        [enabled, routeId],
    )
    return useAtomValue(diffAtom)
}
