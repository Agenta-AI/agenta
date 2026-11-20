import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {markSessionFresh} from "@agenta/chat/state"
import {agentSharingQueryAtomFamily} from "@agenta/entities/sharing"
import {
    agentWorkflowsListQueryStateAtom,
    builderAgentRevisionIdQueryAtom,
} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {userAtom} from "@agenta/shared/state"
import {Button, SimpleTooltip, SplitPane} from "@agenta/ui/ui"
import {
    ArrowsInSimple,
    ArrowsOutSimple,
    LockSimple,
    Robot,
    SidebarSimple,
} from "@phosphor-icons/react"
import type {UIMessage} from "ai"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {newId} from "@/lib/ids"

import {useAgentRow} from "../agent-layout/useAgentRow"
import {openMainSidebar} from "../agent-sidebar/selectedSidebar"
import {builderChatHref} from "../builder/builderChatHref"
import {SessionWorkspaceDrawers} from "../chat/SessionWorkspaceDrawers"
import {ChatLoading} from "../chat/states/ChatStates"
import {ChatUnreachable} from "../chat/states/ChatUnreachable"
import {useSessionHeader} from "../chat/useSessionHeader"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AgentPane} from "./AgentPane"
import {
    PANE_MAX_WIDTH,
    PANE_MIN_WIDTH,
    readBuilderLayout,
    writeBuilderLayout,
    type BuilderPaneLayout,
} from "./builderLayout"
import {BuilderPageChat} from "./BuilderPageChat"
import {createBuilderSidebarScope} from "./builderSidebarScope"
import {
    latestContextAgent,
    latestResultAgent,
    linkedAgentId,
    paneAgentId,
    parseTabParam,
    tabParam,
    type AgentRef,
} from "./paneAgent"

/** A new builder chat: a client-side id that becomes a server session on its first message. */
const newBuilderSessionId = () => {
    const id = newId()
    // Never run: the conversation must not read its empty history as a pruned one.
    markSessionFresh(id)
    return id
}

/** The agents one chat's messages name. */
interface ChatFacts {
    sessionId: string
    result: AgentRef | null
    context: AgentRef | null
}

const sameAgent = (a: AgentRef | null, b: AgentRef | null) => a?.id === b?.id && a?.name === b?.name

/**
 * The builder page: the builder sidebar, the chat, and the pane with the agent tab of the agent
 * the chat is about. `/builder` is a new chat; its first message moves the address to
 * `/builder/{chatId}` with a replace, on the same page file, so nothing remounts.
 */
export const BuilderPage = ({
    workspaceId,
    projectId,
    routeChatId,
    tab,
}: {
    workspaceId: string
    projectId: string
    routeChatId: string | null
    /** `?tab=<kind>:<id>` as the address holds it. */
    tab: string | undefined
}) => {
    const t = useT(builderPageCatalog)
    useBindProjectContext(projectId)
    const router = useRouter()
    const userId = useAtomValue(userAtom)?.id ?? null
    const builder = useAtomValue(builderAgentRevisionIdQueryAtom)
    const builderRevisionId = builder.data ?? null

    // The chat on screen. A route change to another chat shows it; "New chat" (no id in the
    // address after a chat had one) starts a new one.
    const [sessionId, setSessionId] = useState(() => routeChatId ?? newBuilderSessionId())
    const routed = useRef(Boolean(routeChatId))
    useEffect(() => {
        if (routeChatId) {
            routed.current = true
            setSessionId(routeChatId)
        } else if (routed.current) {
            routed.current = false
            setSessionId(newBuilderSessionId())
        }
    }, [routeChatId])

    // What the pane reads of the chat, per chat: set only when it changes, so a streamed chunk
    // renders nothing here.
    const [facts, setFacts] = useState<ChatFacts | null>(null)
    const onMessagesChanged = useCallback(
        (messages: UIMessage[]) => {
            const result = latestResultAgent(messages)
            const context = latestContextAgent(messages)
            setFacts((held) =>
                held?.sessionId === sessionId &&
                sameAgent(held.result, result) &&
                sameAgent(held.context, context)
                    ? held
                    : {sessionId, result, context},
            )
        },
        [sessionId],
    )
    const resultAgent = facts?.sessionId === sessionId ? facts.result : null
    const contextAgent = facts?.sessionId === sessionId ? facts.context : null
    const linkedAgent = useMemo(
        () => (userId ? linkedAgentId(userId, projectId, sessionId) : null),
        [projectId, sessionId, userId],
    )
    const tabRef = parseTabParam(tab)
    const agentId = paneAgentId({tab: tabRef, resultAgent, contextAgent, linkedAgent})

    // The address holds the active tab, written with a replace (no history entry).
    useEffect(() => {
        if (!agentId || (tabRef?.kind === "agent" && tabRef.id === agentId)) return
        void router.replace(
            {query: {...router.query, tab: tabParam({kind: "agent", id: agentId})}},
            undefined,
            {shallow: true},
        )
    }, [agentId, router, tabRef?.id, tabRef?.kind])

    const onFirstSend = useCallback(
        (agent: AgentRef | null) => {
            if (routeChatId === sessionId) return
            routed.current = true
            void router.replace(
                builderChatHref({workspaceId, projectId, sessionId, agentId: agent?.id ?? agentId}),
                undefined,
                {shallow: true},
            )
        },
        [agentId, projectId, routeChatId, router, sessionId, workspaceId],
    )

    const {row} = useAgentRow(agentId ?? "")
    // Deleted or no longer visible: the agent list does not hold it and its access read fails.
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const sharing = useAtomValue(agentSharingQueryAtomFamily(agentId ?? ""))
    const noAccess = Boolean(agentId) && !agents.isPending && !row && sharing.isError
    const agentName =
        row?.name ||
        row?.slug ||
        (resultAgent?.id === agentId ? resultAgent?.name : "") ||
        (contextAgent?.id === agentId ? contextAgent?.name : "") ||
        ""
    const paneAgent = useMemo(
        () => (agentId ? {id: agentId, name: agentName} : null),
        [agentId, agentName],
    )

    const [layout, setLayoutState] = useState<BuilderPaneLayout>(readBuilderLayout)
    const setLayout = (next: Partial<BuilderPaneLayout>) =>
        setLayoutState((held) => {
            const value = {...held, ...next}
            writeBuilderLayout(value)
            return value
        })

    const [builderSidebar, setBuilderSidebar] = useState(true)
    // Another chat, or "Builder" in the main sidebar: the builder sidebar shows again.
    useEffect(() => setBuilderSidebar(true), [sessionId])
    const scope = useMemo(
        () =>
            createBuilderSidebarScope(workspaceId, projectId, () => {
                openMainSidebar()
                setBuilderSidebar(false)
            }),
        [projectId, workspaceId],
    )

    const header = useSessionHeader(projectId, routeChatId ?? "")
    const title = (routeChatId && header.data?.name?.trim()) || t("builder.page.newChat")

    let chat
    if (builder.isPending || !userId) chat = <ChatLoading />
    else if (!builderRevisionId)
        chat = (
            <ChatUnreachable onRetry={() => void builder.refetch()} retrying={builder.isFetching} />
        )
    else
        chat = (
            <BuilderPageChat
                key={sessionId}
                builderRevisionId={builderRevisionId}
                sessionId={sessionId}
                userId={userId}
                workspaceId={workspaceId}
                projectId={projectId}
                paneAgent={paneAgent}
                onFirstSend={onFirstSend}
                onMessagesChanged={onMessagesChanged}
            />
        )

    const showPane = Boolean(agentId) && !layout.hidden
    const chatColumn = (
        <section aria-label={title} className="flex h-full min-h-0 min-w-0 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3">
                <NavDrawer
                    workspaceId={workspaceId}
                    projectId={projectId}
                    scope={builderSidebar ? scope : undefined}
                />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-colorText">
                    {title}
                </span>
                {agentId && layout.hidden ? (
                    <SimpleTooltip title={t("builder.page.openItems")}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("builder.page.openItems")}
                            onClick={() => setLayout({hidden: false})}
                        >
                            <SidebarSimple size={16} className="-scale-x-100" />
                        </Button>
                    </SimpleTooltip>
                ) : null}
            </header>
            <div className="min-h-0 flex-1">{chat}</div>
        </section>
    )

    const pane =
        showPane && agentId ? (
            <section
                aria-label={t("builder.page.openItems")}
                className="flex h-full min-h-0 min-w-0 flex-col border-0 border-l border-solid border-colorBorderSecondary bg-colorBgContainer"
            >
                <PaneHeader
                    agentId={agentId}
                    name={agentName}
                    fullScreen={layout.fullScreen}
                    onFullScreen={() => setLayout({fullScreen: !layout.fullScreen})}
                    onHide={() => setLayout({hidden: true, fullScreen: false})}
                />
                <div className="min-h-0 flex-1">
                    {noAccess ? (
                        <p className="m-0 p-4 text-[13px] text-colorTextSecondary">
                            {t("builder.page.noAccess")}
                        </p>
                    ) : (
                        <AgentPane
                            key={agentId}
                            agentId={agentId}
                            builderSessionId={sessionId}
                            workspaceId={workspaceId}
                            projectId={projectId}
                        />
                    )}
                </div>
            </section>
        ) : null

    return (
        <>
            <PageTitle title={title} />
            <AppShell
                workspaceId={workspaceId}
                projectId={projectId}
                scope={builderSidebar ? scope : undefined}
            >
                <div className="h-full min-h-0" data-testid="builder-page">
                    {!pane ? (
                        chatColumn
                    ) : layout.fullScreen ? (
                        pane
                    ) : (
                        <SplitPane
                            className="h-full"
                            paneSide="end"
                            paneSize={layout.width}
                            paneMin={PANE_MIN_WIDTH}
                            paneMax={PANE_MAX_WIDTH}
                            resizable
                            onResizeEnd={(size) => setLayout({width: size})}
                            pane={pane}
                            fill={chatColumn}
                        />
                    )}
                </div>
            </AppShell>
            {/* The automation, catalog and run history drawers the pane's views open. */}
            <SessionWorkspaceDrawers workspaceId={workspaceId} projectId={projectId} />
        </>
    )
}

/** The top of the pane: the agent tab, "Full screen" and "Hide open items". */
const PaneHeader = ({
    agentId,
    name,
    fullScreen,
    onFullScreen,
    onHide,
}: {
    agentId: string
    name: string
    fullScreen: boolean
    onFullScreen: () => void
    onHide: () => void
}) => {
    const t = useT(builderPageCatalog)
    const isPrivate = useAgentIsPrivate(agentId)
    return (
        <div className="flex h-11 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-2">
            <div
                role="tablist"
                className="flex min-w-0 flex-1 items-center"
                aria-label={t("builder.page.openItems")}
            >
                <span
                    role="tab"
                    aria-selected
                    title={name}
                    className="flex h-8 min-w-0 max-w-[240px] items-center gap-1.5 rounded-md bg-colorFillSecondary px-2 text-[13px] font-medium text-colorText"
                >
                    <Robot aria-hidden size={14} className="shrink-0" />
                    <span className="truncate">{name}</span>
                    {isPrivate ? (
                        <span title={t("builder.page.privateAgent")} className="flex shrink-0">
                            <LockSimple
                                size={12}
                                className="text-colorTextTertiary"
                                aria-label={t("builder.page.privateAgent")}
                            />
                        </span>
                    ) : null}
                </span>
            </div>
            <SimpleTooltip title={t("builder.page.fullScreen")}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("builder.page.fullScreen")}
                    aria-pressed={fullScreen}
                    onClick={onFullScreen}
                >
                    {fullScreen ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
                </Button>
            </SimpleTooltip>
            <SimpleTooltip title={t("builder.page.hideOpenItems")}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("builder.page.hideOpenItems")}
                    onClick={onHide}
                >
                    <SidebarSimple size={16} className="-scale-x-100" />
                </Button>
            </SimpleTooltip>
        </div>
    )
}

/** True when the agent is private: only its owner can see and use it. */
const useAgentIsPrivate = (agentId: string) =>
    useAtomValue(agentSharingQueryAtomFamily(agentId)).data?.sharing.policy.visibility === "private"
