import {fetchTestcasesPage} from "@agenta/entities/testcase"
import type {TestsetLoadPayload} from "@agenta/playground-ui/hooks"

import type {CreatedTestset} from "../testsets/create/useUploadTestset"

/**
 * The load payload for a test set the create dialog just made: all of its rows. Reading the pages
 * also fills the row cache the connect copies the rows from.
 */
export async function createdTestsetPayload(
    projectId: string,
    created: CreatedTestset & {revisionId: string},
): Promise<TestsetLoadPayload> {
    const testcaseIds: string[] = []
    let cursor: string | null = null
    do {
        const page = await fetchTestcasesPage({projectId, revisionId: created.revisionId, cursor})
        testcaseIds.push(...page.testcases.map(({id}) => id))
        cursor = page.hasMore ? page.nextCursor : null
    } while (cursor)
    return {
        revisionId: created.revisionId,
        testcaseIds,
        testsetName: created.name,
        testsetId: created.testsetId,
        revisionVersion: null,
    }
}
