import {
    pickModelName,
    queryWorkflowRevisionsByWorkflow,
    queryWorkflowVariants,
} from "@agenta/entities/workflow"
import {useInfiniteQuery} from "@tanstack/react-query"

export const REVISIONS_PAGE_SIZE = 50

/** One revision of an app, with the name of the variant it belongs to. */
export interface AppRevisionRow {
    revisionId: string
    workflowId: string
    variantId: string
    variantName: string
    variantSlug: string | null
    version: number
    model: string
    message: string | null
    createdAt: string | null
    createdById: string | null
}

export const appRevisionsKey = (projectId: string, appId: string, search: string) =>
    ["workflows", "app-revisions", projectId, appId, search] as const

const hasContent = (value: unknown): boolean => {
    if (value == null || value === "") return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "object") return Object.keys(value).length > 0
    return true
}

/**
 * The empty first revision a new variant starts with: version 0 and nothing in its data (no
 * parameters, no script, no other config). A version 0 that holds anything is a real first commit
 * and stays.
 */
export const isEmptySeed = (revision: {
    version?: number | string | null
    data?: Record<string, unknown> | null
}) => Number(revision.version ?? 0) <= 0 && !Object.values(revision.data ?? {}).some(hasContent)

interface Page {
    rows: AppRevisionRow[]
    next: string | null
}

/**
 * The revisions of one app, newest first, 50 at a time. `search` goes to the server as the name
 * filter. The empty first revision (version 0) is left out.
 *
 * Variant names come from the same query function, so a renamed variant shows its new name after
 * the next fetch and no module keeps an old one.
 */
export const useAppRevisions = ({
    projectId,
    appId,
    search,
}: {
    projectId: string
    appId: string
    search: string
}) => {
    const query = useInfiniteQuery({
        queryKey: appRevisionsKey(projectId, appId, search),
        enabled: Boolean(projectId && appId),
        initialPageParam: null as string | null,
        getNextPageParam: (last: Page) => last.next,
        queryFn: async ({pageParam}): Promise<Page> => {
            const [variants, revisions] = await Promise.all([
                queryWorkflowVariants(appId, projectId),
                queryWorkflowRevisionsByWorkflow(
                    appId,
                    projectId,
                    undefined,
                    {next: pageParam, limit: REVISIONS_PAGE_SIZE, order: "descending"},
                    search || undefined,
                ),
            ])
            const variantById = new Map(variants.workflow_variants.map((v) => [v.id, v]))
            const rows = revisions.workflow_revisions
                .filter((revision) => !isEmptySeed(revision))
                .map((revision): AppRevisionRow => {
                    const variantId = revision.workflow_variant_id ?? revision.variant_id ?? ""
                    const variant = variantById.get(variantId)
                    return {
                        revisionId: revision.id,
                        workflowId: revision.workflow_id ?? appId,
                        variantId,
                        variantName: variant?.name ?? variant?.slug ?? revision.name ?? variantId,
                        variantSlug: variant?.slug ?? revision.variant_slug ?? null,
                        version: Number(revision.version),
                        model: pickModelName(revision.data?.parameters ?? null),
                        message: revision.message ?? null,
                        createdAt: revision.created_at ?? null,
                        createdById: revision.created_by_id ?? null,
                    }
                })
            return {rows, next: revisions.windowing?.next ?? null}
        },
    })

    return {
        rows: query.data?.pages.flatMap((page) => page.rows) ?? [],
        isPending: query.isPending,
        isError: query.isError,
        hasMore: query.hasNextPage,
        isLoadingMore: query.isFetchingNextPage,
        loadMore: query.fetchNextPage,
        refetch: query.refetch,
    }
}
