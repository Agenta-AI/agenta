import {useState} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {sessionListQueryOptions} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {livePollInterval} from "@agenta/navigation"
import {sessionRowVm} from "@agenta/sessions/row"
import {LoadError} from "@agenta/ui/components/presentational"
import {Popover, PopoverContent, PopoverTrigger, SkeletonRows, Spinner} from "@agenta/ui/ui"
import {CaretUpDown, Circle} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"

import {cn} from "@/lib/utils"

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

/** The session the Sessions pane tab shows: the one picked in the switcher, else the latest. */
export const usePaneSessionPick = (projectId: string, agentId: string) => {
    const query = usePaneSessions(projectId, agentId)
    const [pickedId, setPickedId] = useState<string | null>(null)
    const rows = query.data?.sessions ?? []
    const session = rows.find((row) => row.session_id === pickedId) ?? rows[0] ?? null
    return {query, rows, session, pick: setPickedId}
}
export type PaneSessionPick = ReturnType<typeof usePaneSessionPick>

const StatusMark = ({session}: {session: SessionStream}) =>
    sessionRowVm(session, {pinned: false, pending: undefined}).status.status === "running" ? (
        <Spinner className="size-3 shrink-0" />
    ) : (
        <Circle aria-hidden size={12} className="shrink-0 text-colorTextSecondary" />
    )

const titleOf = (session: SessionStream) =>
    sessionRowVm(session, {pinned: false, pending: undefined}).title

/**
 * The session switcher at the end of the pane sub-tab row (B04): the session on screen, and the
 * agent's latest sessions to pick from.
 */
export const PaneSessionSwitcher = ({pick}: {pick: PaneSessionPick}) => {
    const t = useT(builderPageCatalog)
    const [open, setOpen] = useState(false)
    const current = pick.session
    if (!current) return null
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid="pane-session-switcher"
                    aria-haspopup="listbox"
                    className="box-border flex h-7 w-[172px] min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-[6px] border border-solid border-colorBorder bg-colorBgContainer pl-2.5 pr-2 text-left text-[13px] font-medium leading-5 text-colorText hover:bg-zinc-1"
                >
                    <StatusMark session={current} />
                    <span className="min-w-0 flex-1 truncate">{titleOf(current)}</span>
                    <CaretUpDown
                        aria-hidden
                        size={14}
                        className="shrink-0 text-colorTextTertiary"
                    />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                aria-label={t("builder.page.sessions")}
                className="flex max-h-[360px] w-[280px] flex-col overflow-y-auto p-1"
            >
                {pick.rows.map((row) => (
                    <button
                        key={row.session_id}
                        type="button"
                        aria-current={row.session_id === current.session_id || undefined}
                        onClick={() => {
                            pick.pick(row.session_id)
                            setOpen(false)
                        }}
                        className={cn(
                            "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[13px] text-colorText hover:bg-colorFillTertiary",
                            row.session_id === current.session_id && "bg-colorFillSecondary",
                        )}
                    >
                        <StatusMark session={row} />
                        <span className="min-w-0 flex-1 truncate">{titleOf(row)}</span>
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    )
}

/**
 * The Sessions pane tab of an agent tab (B04): the session the switcher picked, the latest one
 * first. The address does not change.
 */
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
