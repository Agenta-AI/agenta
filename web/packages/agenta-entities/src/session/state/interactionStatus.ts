/**
 * Terminal status join for transcript replay — the cheapest correct source for "was this parked
 * client-tool interaction already resolved server-side?"
 *
 * The durable record log (`sessionRecordsQueryFamily`) replays a `client_tool` interaction request
 * from its own `interaction_request` event alone; it never carries the interaction's later
 * lifecycle (a `session_interactions` row concept, not a record). A normal live settle (connect,
 * elicitation answer) DOES leave a trace: the browser's `addToolOutput` resubmits the result, and
 * the runner re-emits it as a `tool_result` record that settles the part on replay too — no query
 * needed. But a server-side cancellation (the stale-interaction sweep, or any path that never
 * round-trips a tool_result) leaves the transcript with nothing but the original request, which
 * replays as a fully interactive, still-pending form forever.
 *
 * `session_interactions.token` is the join key: it equals the record's `toolCallId` (confirmed
 * against a live 8180 row: token `call_n7Gec...` == the `interaction_request` record's
 * `toolCallId` == its `attributes.id`). So the cheapest fix is one small, best-effort query for the
 * session's `client_tool` interactions, filtered to `cancelled`, keyed by that token.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {queryInteractions} from "../api/api"

const CANCELLED_CLIENT_TOOL_TOKENS_STALE_MS = 15_000

export const cancelledClientToolTokensQueryKey = (projectId: string, sessionId: string) =>
    ["session", "interactions", "cancelledClientToolTokens", projectId, sessionId] as const

const cancelledClientToolTokensQueryOptions = (projectId: string, sessionId: string) => ({
    queryKey: cancelledClientToolTokensQueryKey(projectId, sessionId),
    queryFn: async (): Promise<ReadonlySet<string>> => {
        const interactions = await queryInteractions({sessionId, projectId, kind: "client_tool"})
        const tokens = (interactions ?? [])
            .filter((i) => i.status === "cancelled" && typeof i.token === "string" && i.token)
            .map((i) => i.token as string)
        return new Set(tokens)
    },
    staleTime: CANCELLED_CLIENT_TOOL_TOKENS_STALE_MS,
})

/**
 * Imperative, best-effort fetch through the shared query cache. Never throws — a failure (network,
 * missing project scope) resolves to an empty set, so a resurrected-form miss degrades to today's
 * behavior (still pending) rather than blocking the whole transcript from loading.
 */
export const fetchCancelledClientToolTokensAtom = atom(
    null,
    async (get, _set, sessionId: string): Promise<ReadonlySet<string>> => {
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId) return new Set()
        try {
            const client = get(queryClientAtom)
            return await client.fetchQuery(
                cancelledClientToolTokensQueryOptions(projectId, sessionId),
            )
        } catch (err) {
            console.warn("[fetchCancelledClientToolTokensAtom] fetch failed:", err)
            return new Set()
        }
    },
)
