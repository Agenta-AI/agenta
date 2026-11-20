import {useState} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {sessionListQueryOptions} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {livePollInterval} from "@agenta/navigation"
import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonRows} from "@agenta/ui/ui"
import {useQuery} from "@tanstack/react-query"

import {AutomationRunConversation} from "../automations/AutomationRunConversation"

/** How many latest sessions the pane lists. */
const PANE_SESSION_LIMIT = 50

/** One agent's latest sessions and the count of all of them, in one request. */
export const paneSessionsQuery = (projectId: string, agentId: string) => {
    const options = sessionListQueryOptions({
        projectId,
        agentId,
        includeTotal: true,
        limit: PANE_SESSION_LIMIT,
    })
    return {
        queryKey: [...options.queryKey, "first-page"],
        queryFn: async ({signal}: {signal?: AbortSignal}) => {
            const page = await options.queryFn({pageParam: null, signal})
            if (!page) throw new Error("The session list did not load")
            return page
        },
        staleTime: 30_000,
    }
}

export const usePaneSessions = (projectId: string, agentId: string) =>
    useQuery({
        ...paneSessionsQuery(projectId, agentId),
        refetchInterval: (query) => livePollInterval(query.state.data?.sessions),
    })

/** The session the Sessions tab shows: the first latest one, then the pick; kept on refresh. */
export const usePaneSessionPick = (projectId: string, agentId: string) => {
    const query = usePaneSessions(projectId, agentId)
    const rows = query.data?.sessions ?? []
    const [picked, setPicked] = useState<SessionStream | null>(null)
    if (!picked && rows[0]) setPicked(rows[0])
    const session = rows.find((row) => row.session_id === picked?.session_id) ?? picked
    const pick = (sessionId: string) => {
        const row = rows.find((entry) => entry.session_id === sessionId)
        if (row) setPicked(row)
    }
    return {query, session, pick}
}
export type PaneSessionPick = ReturnType<typeof usePaneSessionPick>

/** The Sessions pane tab (B04): the session the switcher picked. */
export const PaneSessions = ({
    pick,
    agentId,
    projectId,
    workspaceId,
}: {
    pick: PaneSessionPick
    agentId: string
    projectId: string
    workspaceId: string
}) => {
    const t = useT(builderPageCatalog)
    const {query, session} = pick
    if (query.isPending) return <SkeletonRows count={6} className="p-4" />
    if (query.isError)
        return (
            <div className="p-4">
                <LoadError
                    framed
                    title={t("builder.page.sessionsFailed")}
                    onRetry={() => void query.refetch()}
                />
            </div>
        )
    if (!session)
        return (
            <p className="m-0 p-4 text-[13px] text-colorTextSecondary">
                {t("builder.page.noSessions")}
            </p>
        )
    return (
        <div className="h-full min-h-0" data-testid="pane-sessions">
            <AutomationRunConversation
                key={session.session_id}
                sessionId={session.session_id}
                projectId={projectId}
                workspaceId={workspaceId}
                agentId={agentId}
            />
        </div>
    )
}
