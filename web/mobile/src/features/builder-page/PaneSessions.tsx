import {useState} from "react"

import {sessionMessagesAtom, sessionStatusAtomFamily} from "@agenta/chat/state"
import type {SessionStream} from "@agenta/entities/session"
import {sessionListQueryOptions} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {livePollInterval} from "@agenta/navigation"
import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonRows} from "@agenta/ui/ui"
import {useQuery} from "@tanstack/react-query"
import {useStore} from "jotai"

import {AutomationRunConversation} from "../automations/AutomationRunConversation"
import {mintBlankSession} from "../chat/useStartBlankSession"

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

/**
 * The session the Sessions tab shows: the first latest one, then the pick; kept on refresh.
 * "New session" shows a blank session. The picker lists it first until the server list has it
 * (after its first message), so a switch away does not lose it or its draft.
 */
export const usePaneSessionPick = (projectId: string, agentId: string) => {
    const query = usePaneSessions(projectId, agentId)
    const store = useStore()
    const rows = query.data?.sessions ?? []
    const [picked, setPicked] = useState<SessionStream | null>(null)
    const [blanks, setBlanks] = useState<SessionStream[]>([])
    const unlisted = blanks.filter(
        (blank) => !rows.some((row) => row.session_id === blank.session_id),
    )
    // Once the server list has a blank session, the list owns it.
    if (unlisted.length !== blanks.length) setBlanks(unlisted)
    const sessions = [...unlisted, ...rows]
    if (!picked && sessions[0]) setPicked(sessions[0])
    // The pick follows its latest listed row, and keeps it after the row leaves the list.
    const listed = sessions.find((row) => row.session_id === picked?.session_id)
    if (listed && listed !== picked) setPicked(listed)
    const session = listed ?? picked
    const pick = (sessionId: string) => {
        const row = sessions.find((entry) => entry.session_id === sessionId)
        if (row) setPicked(row)
    }
    const startNew = () => {
        // A blank session with no message sent is still the new session: a second tap, or a tap
        // after a switch away, shows it again and does not add another "Untitled session".
        const unused = unlisted.find(
            ({session_id: id}) =>
                !store.get(sessionMessagesAtom)[id]?.length &&
                store.get(sessionStatusAtomFamily(id)) === "idle",
        )
        if (unused) return setPicked(unused)
        const blank = {project_id: projectId, session_id: mintBlankSession()}
        setBlanks((current) => [blank, ...current])
        setPicked(blank)
    }
    return {query, sessions, session, pick, startNew}
}
export type PaneSessionPick = ReturnType<typeof usePaneSessionPick>

/** The Sessions pane tab (B04, B07): the session the picker shows. */
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
    // A picked or new session shows even when the list fails, as "New session" still works.
    if (!session) {
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
        return (
            <p className="m-0 p-4 text-body text-muted-foreground">
                {t("builder.page.noSessions")}
            </p>
        )
    }
    return (
        <div className="h-full min-h-0" data-testid="pane-sessions">
            <AutomationRunConversation
                key={session.session_id}
                sessionId={session.session_id}
                projectId={projectId}
                workspaceId={workspaceId}
                agentId={agentId}
                withComposer
            />
        </div>
    )
}
