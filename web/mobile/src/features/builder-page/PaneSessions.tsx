import {useState} from "react"

import {sessionListQueryOptions} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {livePollInterval} from "@agenta/navigation"
import {sessionRowVm} from "@agenta/sessions/row"
import {LoadError} from "@agenta/ui/components/presentational"
import {Button, SkeletonRows, Spinner} from "@agenta/ui/ui"
import {ArrowLeft, Circle} from "@phosphor-icons/react"
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

/**
 * The Sessions pane tab of an agent tab: the agent's latest sessions. A pick shows the session
 * in the pane, and the address does not change.
 */
export const PaneSessions = ({
    agentId,
    projectId,
    workspaceId,
}: {
    agentId: string
    projectId: string
    workspaceId: string
}) => {
    const t = useT(builderPageCatalog)
    const query = usePaneSessions(projectId, agentId)
    const [openId, setOpenId] = useState<string | null>(null)

    if (openId)
        return (
            <div className="flex h-full min-h-0 flex-col">
                <div className="flex h-10 shrink-0 items-center px-2">
                    <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
                        <ArrowLeft aria-hidden size={14} />
                        {t("builder.page.back")}
                    </Button>
                </div>
                <div className="min-h-0 flex-1">
                    <AutomationRunConversation
                        sessionId={openId}
                        projectId={projectId}
                        workspaceId={workspaceId}
                        agentId={agentId}
                    />
                </div>
            </div>
        )

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
    const rows = query.data.sessions ?? []
    if (rows.length === 0)
        return (
            <p className="m-0 p-4 text-[13px] text-colorTextSecondary">
                {t("builder.page.noSessions")}
            </p>
        )
    return (
        <div
            className="flex h-full min-h-0 flex-col overflow-y-auto p-2"
            data-testid="pane-sessions"
        >
            {rows.map((row) => {
                const vm = sessionRowVm(row, {pinned: false, pending: undefined})
                return (
                    <button
                        key={vm.id}
                        type="button"
                        onClick={() => setOpenId(vm.id)}
                        className="flex h-9 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[13px] text-colorText hover:bg-colorFillTertiary"
                    >
                        {vm.status.status === "running" ? (
                            <Spinner className="size-3 shrink-0" />
                        ) : (
                            <Circle
                                aria-hidden
                                size={8}
                                className="shrink-0 text-colorTextTertiary"
                            />
                        )}
                        <span className="min-w-0 flex-1 truncate">{vm.title}</span>
                    </button>
                )
            })}
        </div>
    )
}
