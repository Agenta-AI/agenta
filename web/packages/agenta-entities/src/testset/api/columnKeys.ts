import {fetchRevisionWithTestcases} from "./api"

/**
 * The column names of a revision: the top-level keys of every row, in first-seen order.
 *
 * It reads every row, because a table reads its columns from the first rows only and a name
 * used only by a later row would be missed. It throws when the revision does not return all its
 * rows, since a missing row could hold a name the caller is checking.
 */
export async function fetchRevisionColumnKeys({
    projectId,
    revisionId,
}: {
    projectId: string
    revisionId: string
}): Promise<{keys: string[]; hasRows: boolean}> {
    const revision = await fetchRevisionWithTestcases({id: revisionId, projectId})
    if (!revision) throw new Error("The revision was not found")
    const ids = revision.data?.testcase_ids
    const testcases = revision.data?.testcases
    if (!ids?.length && !testcases?.length) return {keys: [], hasRows: false}
    if (!Array.isArray(testcases) || (ids && ids.length !== testcases.length)) {
        throw new Error("The revision did not return all its testcases")
    }
    const keys = new Set<string>()
    for (const testcase of testcases) {
        const data = (testcase as {data?: Record<string, unknown> | null}).data
        for (const [key, value] of Object.entries(data ?? {})) {
            if (value !== undefined) keys.add(key)
        }
    }
    return {keys: [...keys], hasRows: true}
}
