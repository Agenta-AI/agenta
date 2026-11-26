import {fetchTestcasesBatch, fetchTestcasesRaw} from "@agenta/entities/testcase"
import type {TestsetLoadPayload} from "@agenta/playground-ui/hooks"

import type {CreatedTestset} from "../testsets/create/useUploadTestset"

/**
 * The load payload for a test set the create dialog just made: all of its rows. The page fetch
 * hides a failed request as an empty page, so this reads the pages with the fetch that reports a
 * failure, then loads the rows by id: that fills the row cache the connect copies from and proves
 * that every row arrived. It throws when any of this fails.
 */
export async function createdTestsetPayload(
    projectId: string,
    created: CreatedTestset & {revisionId: string},
): Promise<TestsetLoadPayload> {
    const testcaseIds: string[] = []
    let next: string | undefined
    do {
        const page = await fetchTestcasesRaw(projectId, {
            testset_revision_ref: {id: created.revisionId},
            windowing: {limit: 50, ...(next ? {next} : {})},
        })
        if (!page) throw new Error("The rows of the new test set did not load")
        testcaseIds.push(...page.testcases.map(({id}) => id))
        next = page.windowing?.next ?? undefined
    } while (next)

    const rows = await fetchTestcasesBatch({projectId, testcaseIds})
    if (rows.size !== testcaseIds.length)
        throw new Error("Some rows of the new test set did not load")
    return {
        revisionId: created.revisionId,
        testcaseIds,
        testsetName: created.name,
        testsetId: created.testsetId,
        revisionVersion: null,
    }
}
