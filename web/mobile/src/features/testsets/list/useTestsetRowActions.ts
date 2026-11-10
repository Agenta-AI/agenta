import {useCallback, useRef, useState} from "react"

import {
    downloadTestset,
    fetchEvaluationRunIdsUsingTestsets,
    fetchLatestRevision,
    testsetMolecule,
} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import type {TestsetExportFormat, TestsetRow} from "./testsetRowTypes"

/** What an action needs of a row. */
type TestsetRowRef = Pick<TestsetRow, "id" | "name">

/** The file name an export saves as: the name with every unsafe character turned into `-`. */
export const exportFileName = (name: string, format: TestsetExportFormat): string =>
    `${name.replace(/[^a-zA-Z0-9-_]/g, "-")}.${format}`

const inUseMessage = (count: number, testsets: number): string => {
    const noun = count === 1 ? "evaluation" : "evaluations"
    const subject = testsets === 1 ? "The test set is" : "These test sets are"
    return `${subject} used by ${count} ${noun}. Archive or delete the ${noun} first.`
}

/** Thrown for the one refusal the reader can act on; its message is safe to show. */
class TestsetInUseError extends Error {}

const ROW_BUSY = "This test set is busy. Try again in a moment"
const ROWS_BUSY = "A selected test set is busy. Try again in a moment"
const ARCHIVE_FAILED = "Couldn't archive this test set"
const ARCHIVE_MANY_FAILED = "Couldn't archive these test sets"

/**
 * The verbs a testset row offers. Each runs once per row at a time: a second press while one is
 * running does nothing, and `isBusy` tells the row to show it.
 *
 * `archive` throws a plain `Error` when it cannot archive. The confirm dialog shows that text and
 * stays open, so the reader never sees an API message.
 */
export function useTestsetRowActions({
    projectId,
    base,
    includeArchived = false,
}: {
    projectId: string
    base: string
    /** Open the revisions of archived testsets, as the archived list does. */
    includeArchived?: boolean
}) {
    const router = useRouter()
    const queryClient = useQueryClient()
    const running = useRef(new Set<string>())
    const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())

    // Runs `work` unless one of these rows is already busy. The ref is the guard (it answers at
    // once), the state only drives what is drawn.
    const guardedAll = useCallback(
        async <T>(ids: readonly string[], work: () => Promise<T>): Promise<T | undefined> => {
            if (ids.some((id) => running.current.has(id))) return undefined
            ids.forEach((id) => running.current.add(id))
            setBusyIds(new Set(running.current))
            try {
                return await work()
            } finally {
                ids.forEach((id) => running.current.delete(id))
                setBusyIds(new Set(running.current))
            }
        },
        [],
    )
    const guarded = useCallback(
        <T>(id: string, work: () => Promise<T>) => guardedAll([id], work),
        [guardedAll],
    )

    const openLatest = useCallback(
        (row: TestsetRowRef) =>
            guarded(row.id, async () => {
                try {
                    const revision = await fetchLatestRevision({
                        projectId,
                        testsetId: row.id,
                        includeArchived,
                    })
                    // Version 0 is the empty placeholder every Testset starts with.
                    if (!revision || revision.version <= 0) {
                        message.error("This test set has no saved revision yet")
                        return
                    }
                    await router.push(`${base}/testsets/${revision.id}`)
                } catch {
                    message.error("Couldn't open this test set")
                }
            }),
        [base, guarded, includeArchived, projectId, router],
    )

    const exportTestset = useCallback(
        (row: TestsetRowRef, format: TestsetExportFormat) =>
            guarded(row.id, async () => {
                const hide = message.loading("Preparing export. This may take a moment…", 0)
                try {
                    await downloadTestset({
                        projectId,
                        testsetId: row.id,
                        fileType: format,
                        filename: exportFileName(row.name, format),
                    })
                    message.success(`Testset exported as ${format.toUpperCase()}`)
                } catch {
                    message.error("Failed to export")
                } finally {
                    hide()
                }
            }),
        [guarded, projectId],
    )

    /** Each test set downloads as its own file, one after another, as the old app does. */
    const exportMany = useCallback(
        async (rows: readonly TestsetRowRef[], format: TestsetExportFormat) => {
            for (const row of rows) await exportTestset(row, format)
        },
        [exportTestset],
    )

    /**
     * Archive one or more test sets with all their revisions. Refused as a whole when an
     * evaluation uses any of them, as the old app does: nothing is archived then.
     */
    const archiveMany = useCallback(
        async (rows: readonly TestsetRowRef[]): Promise<void> => {
            if (rows.length === 0) return
            const ids = rows.map((row) => row.id)
            const single = ids.length === 1
            const done = await guardedAll(ids, async () => {
                try {
                    const runIds = await fetchEvaluationRunIdsUsingTestsets({
                        projectId,
                        testsetIds: ids,
                    })
                    if (runIds.length > 0) {
                        throw new TestsetInUseError(inUseMessage(runIds.length, ids.length))
                    }
                    await testsetMolecule.lifecycle.archive(ids, {projectId})
                } catch (cause) {
                    if (cause instanceof TestsetInUseError) throw cause
                    throw new Error(single ? ARCHIVE_FAILED : ARCHIVE_MANY_FAILED)
                }
                message.success(single ? "Testset archived" : `${ids.length} test sets archived`)
                await queryClient.invalidateQueries({queryKey: ["testsets"]})
                return true
            })
            // A row was busy (opening or exporting): say so, or the dialog would close as if it worked.
            if (!done) throw new Error(single ? ROW_BUSY : ROWS_BUSY)
        },
        [guardedAll, projectId, queryClient],
    )

    const archive = useCallback((row: TestsetRowRef) => archiveMany([row]), [archiveMany])

    const isBusy = useCallback((id: string) => busyIds.has(id), [busyIds])

    return {
        openLatest,
        exportTestset,
        exportMany,
        archive,
        archiveMany,
        isBusy,
        isAnyBusy: busyIds.size > 0,
    }
}
