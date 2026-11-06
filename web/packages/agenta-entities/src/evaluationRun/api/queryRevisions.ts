/**
 * Stored query revisions: the trace filter a live evaluation reads.
 *
 * @packageDocumentation
 */

import {getQueriesClient} from "@agenta/sdk/resources"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared/utils/zodSchema"

export const liveQueryRevisionSchema = z.object({
    id: z.string(),
    version: z.union([z.string(), z.number()]).nullable().optional(),
    data: z
        .object({
            filtering: z.unknown().optional(),
            windowing: z
                .object({rate: z.number().nullable().optional()})
                .passthrough()
                .nullable()
                .optional(),
        })
        .passthrough()
        .nullable()
        .optional(),
})
export type LiveQueryRevision = z.infer<typeof liveQueryRevisionSchema>

const queryRevisionsResponseSchema = z.object({
    query_revisions: z.array(liveQueryRevisionSchema).default([]),
})

/** `POST /queries/revisions/query`: the revisions with these ids, archived ones included. */
export async function queryLiveQueryRevisions({
    projectId,
    revisionIds,
}: {
    projectId: string
    revisionIds: string[]
}): Promise<LiveQueryRevision[]> {
    if (revisionIds.length === 0) return []
    const response = await getQueriesClient().queryQueryRevisions(
        {query_revision_refs: revisionIds.map((id) => ({id})), include_archived: true},
        {queryParams: {project_id: projectId}},
    )
    const parsed = safeParseWithLogging(
        queryRevisionsResponseSchema,
        response,
        "[queryLiveQueryRevisions]",
    )
    if (!parsed) {
        throw new Error("The query revisions response did not match the expected shape.")
    }
    return parsed.query_revisions
}
