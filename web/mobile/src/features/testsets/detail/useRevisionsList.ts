import {useCallback, useMemo, useState} from "react"

import {fetchRevisionsList} from "@agenta/entities/testset"
import {useQuery} from "@tanstack/react-query"

export interface RevisionOption {
    id: string
    version: number
    createdAt: string | null
    message: string | null
    authorId: string | null
}

/** The key starts with `testsets`, so a write that invalidates `["testsets"]` refreshes it. */
export const revisionsListQueryKey = (projectId: string, testsetId: string) =>
    ["testsets", "revisions", projectId, testsetId] as const

/**
 * The saved revisions of one test set, newest first. Version 0 is the empty placeholder every
 * test set starts with, so it is left out.
 *
 * Nothing loads until `load()` runs, which the version menu and the actions menu call when they
 * first open. `status` tells "not asked yet" from "loading", because the old app showed a
 * different text for each.
 */
export function useRevisionsList({
    projectId,
    testsetId,
}: {
    projectId: string
    testsetId: string | undefined
}) {
    const [requested, setRequested] = useState(false)
    const enabled = requested && Boolean(projectId && testsetId)

    const query = useQuery({
        queryKey: revisionsListQueryKey(projectId, testsetId ?? ""),
        queryFn: async (): Promise<RevisionOption[]> => {
            const response = await fetchRevisionsList({projectId, testsetId: testsetId ?? ""})
            return response.testset_revisions
                .map((raw) => ({
                    id: raw.id,
                    version: raw.version,
                    createdAt: raw.created_at ?? raw.date ?? null,
                    message: raw.message ?? null,
                    authorId: raw.author ?? raw.created_by_id ?? null,
                }))
                .filter((revision) => revision.version > 0)
                .sort((a, b) => b.version - a.version)
        },
        enabled,
        retry: false,
    })

    const load = useCallback(() => setRequested(true), [])
    const revisions = useMemo(() => query.data ?? [], [query.data])
    const status: "idle" | "loading" | "ready" | "error" = !requested
        ? "idle"
        : query.isError
          ? "error"
          : query.isSuccess
            ? "ready"
            : "loading"

    return {revisions, status, load, latestVersion: revisions[0]?.version ?? 0}
}

export type RevisionsList = ReturnType<typeof useRevisionsList>
