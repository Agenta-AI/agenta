import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {useDriveDirtyGuard} from "@agenta/entities/drive"
import {
    agentWorkflowsListQueryStateAtom,
    builderAgentRevisionIdQueryAtom,
} from "@agenta/entities/workflow"
import type {MarkableSectionKey} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {userAtom} from "@agenta/shared/state"
import {useMediaQuery} from "@agenta/ui/hooks"
import {Button, SimpleTooltip, SplitPane} from "@agenta/ui/ui"
import {ArrowsInSimple, ArrowsOutSimple, Plus, SidebarSimple} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"

import type {PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"
import {openMainSidebar} from "../agent-sidebar/selectedSidebar"
import {linkedAgentIdOf} from "../builder/builderChatLink"
import {newBuilderSessionId} from "../builder/newBuilderSession"
import {SessionWorkspaceDrawers} from "../chat/SessionWorkspaceDrawers"
import {ChatLoading} from "../chat/states/ChatStates"
import {ChatUnreachable} from "../chat/states/ChatUnreachable"
import {useSessionHeader} from "../chat/useSessionHeader"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AgentPicker} from "./AgentPicker"
import {BuilderChatTitle} from "./BuilderChatTitle"
import {
    PANE_MAX_WIDTH,
    PANE_MIN_WIDTH,
    readBuilderPaneLayout,
    writeBuilderPaneLayout,
    type BuilderPaneLayout,
} from "./builderLayout"
import {BuilderPageChat} from "./BuilderPageChat"
import {createBuilderSidebarScope} from "./builderSidebarScope"
import {BUILDER_TAB_ID, BUILDER_TAB_PANEL_ID} from "./BuilderTabButton"
import {BuilderTabContent} from "./BuilderTabContent"
import {builderTabKey, type BuilderTab} from "./builderTabs"
import {BuilderTabStrip} from "./BuilderTabStrip"
import type {AgentRef} from "./paneAgent"
import {useBuilderTabs} from "./useBuilderTabs"

/** The chat keeps at least this width beside the pane, in px. */
const CHAT_MIN_WIDTH = 320

/**
 * The builder page: the builder sidebar, the chat, and the pane with the builder tabs of the
 * chat (the agents its builder results saved, the items the person opened, the tab a link
 * names). `/builder` is a new chat; its first message moves the address to `/builder/{chatId}`
 * with a replace, on the same page file, so nothing remounts.
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
    // An unsaved file edit in the Drives pane tab warns before a tab close, as on the session page.
    useDriveDirtyGuard()
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

    const linkedAgentId = useMemo(
        () => (userId ? linkedAgentIdOf(userId, projectId, sessionId) : null),
        [projectId, sessionId, userId],
    )
    const tabs = useBuilderTabs({
        sessionId,
        routeChatId,
        tab,
        linkedAgentId,
        workspaceId,
        projectId,
    })
    const activeTab =
        tabs.state.tabs.find((held) => builderTabKey(held) === tabs.state.active) ?? null
    const {clearChangedSection} = tabs
    const activeKey = tabs.state.active
    const onSectionOpened = useCallback(
        (section: MarkableSectionKey) => {
            if (activeKey) clearChangedSection(activeKey, section)
        },
        [activeKey, clearChangedSection],
    )
    // The active tab's open views: a form with edits asks before the tab changes or closes.
    const paneGuard = useRef<PageViewStackGuardApi | null>(null)
    const leaveActiveTab = async () => {
        const guard = paneGuard.current
        if (!guard) return true
        if (!(await guard.stack.closeAll())) return false
        // The address change of the tab switch goes through: the person already answered.
        guard.allowNext()
        return true
    }
    const onFirstSend = useCallback(
        (agent: AgentRef | null) => {
            if (routeChatId === sessionId) return
            routed.current = true
            tabs.onFirstSend(agent)
        },
        [routeChatId, sessionId, tabs],
    )

    // A tab shows its own name, else the agent list's name, else its kind.
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agentNames = useMemo(
        () =>
            new Map((agents.data ?? []).map((agent) => [agent.id, agent.name || agent.slug || ""])),
        [agents.data],
    )
    const kindLabels: Record<BuilderTab["kind"], string> = {
        agent: t("builder.page.kindAgent"),
        automation: t("builder.page.kindAutomation"),
        tool: t("builder.page.kindTool"),
        app: t("builder.page.kindApp"),
    }
    const label = (held: BuilderTab) =>
        (held.kind === "agent" ? agentNames.get(held.id) : "") || held.name || kindLabels[held.kind]
    // The chip of the next message: the agent of the active tab (design D13, builder page).
    const activeAgentName = activeTab?.kind === "agent" ? label(activeTab) : ""
    const paneAgent = useMemo(
        () => (activeTab?.kind === "agent" ? {id: activeTab.id, name: activeAgentName} : null),
        [activeTab?.kind, activeTab?.id, activeAgentName],
    )

    const [layout, setLayoutState] = useState<BuilderPaneLayout>(readBuilderPaneLayout)
    const setLayout = (next: Partial<BuilderPaneLayout>) =>
        setLayoutState((held) => {
            const value = {...held, ...next}
            writeBuilderPaneLayout(value)
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

    // A page-sized layer for dialogs that cover the page but not the sidebar (Browse ideas, B02).
    // `contain: layout` makes it the box their fixed mask and positioner fill. Not the dialog's
    // `contained` mode: that one is non-modal (no focus trap) and its mask always blurs.
    const [dialogHost, setDialogHost] = useState<HTMLDivElement | null>(null)

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
                isNew={routeChatId !== sessionId}
                userId={userId}
                workspaceId={workspaceId}
                projectId={projectId}
                paneAgent={paneAgent}
                activeTabKey={tabs.state.active}
                onFirstSend={onFirstSend}
                onMessagesChanged={tabs.onMessagesChanged}
                dialogContainer={dialogHost}
            />
        )

    // Below 768 px the pane and the chat do not fit side by side: the pane shows full screen
    // when the person opens it, and this choice is not stored (a wider window keeps its layout).
    const phone = useMediaQuery("(max-width: 767.98px)")
    const [phonePane, setPhonePane] = useState(false)
    const paneOpen = Boolean(activeTab) && (phone ? phonePane : !layout.hidden)
    const paneFull = paneOpen && (phone || layout.fullScreen)
    // Live width while the divider moves; stored when the drag ends.
    const [dragWidth, setDragWidth] = useState<number | null>(null)
    const chatColumn = (
        <section aria-label={title} className="flex h-full min-h-0 min-w-0 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3 md:pl-4">
                <NavDrawer
                    workspaceId={workspaceId}
                    projectId={projectId}
                    scope={builderSidebar ? scope : undefined}
                />
                {routeChatId && routeChatId === sessionId ? (
                    <BuilderChatTitle
                        title={title}
                        session={header.data}
                        sessionId={sessionId}
                        workspaceId={workspaceId}
                        projectId={projectId}
                        userId={userId}
                    />
                ) : (
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-colorText">
                        {title}
                    </span>
                )}
                {activeTab && !paneOpen ? (
                    <SimpleTooltip title={t("builder.page.openItems")}>
                        <Button
                            variant="ghost"
                            size="icon-compact"
                            aria-label={t("builder.page.openItems")}
                            onClick={() =>
                                phone ? setPhonePane(true) : setLayout({hidden: false})
                            }
                        >
                            <SidebarSimple className="-scale-x-100" />
                        </Button>
                    </SimpleTooltip>
                ) : null}
                {!activeTab && routeChatId === sessionId ? (
                    // Every tab of this chat is closed: "+" opens an item again.
                    <AgentPicker
                        onPick={(agent) =>
                            tabs.open({kind: "agent", id: agent.id, name: agent.name})
                        }
                        trigger={
                            <Button
                                variant="ghost"
                                size="icon-compact"
                                aria-label={t("builder.page.openItem")}
                                title={t("builder.page.openItem")}
                            >
                                <Plus />
                            </Button>
                        }
                    />
                ) : null}
            </header>
            <div className="min-h-0 flex-1">{chat}</div>
        </section>
    )

    // The pane stays mounted while it is hidden or the chat is full screen, so neither an open
    // form in the pane nor a running answer in the chat is lost by a layout change.
    const pane = activeTab ? (
        <section
            aria-label={t("builder.page.openItems")}
            className="flex h-full min-h-0 min-w-0 flex-col border-0 border-l border-solid border-colorBorderSecondary bg-colorBgContainer"
        >
            <div className="flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3">
                <BuilderTabStrip
                    tabs={tabs.state.tabs}
                    active={tabs.state.active}
                    label={label}
                    onActivate={async (key) => {
                        if (key === tabs.state.active || !(await leaveActiveTab())) return
                        tabs.activate(key)
                    }}
                    onClose={async (key) => {
                        if (key === tabs.state.active && !(await leaveActiveTab())) return
                        tabs.close(key)
                    }}
                    onOpenAgent={async (agent) => {
                        const next: BuilderTab = {kind: "agent", id: agent.id, name: agent.name}
                        // Only a real change of the active tab asks and passes the next navigation.
                        const changes = builderTabKey(next) !== tabs.state.active
                        if (changes && !(await leaveActiveTab())) return
                        tabs.open(next)
                    }}
                />
                {phone ? null : (
                    <>
                        <span aria-hidden className="h-4 w-px shrink-0 bg-colorBorderSecondary" />
                        <SimpleTooltip title={t("builder.page.fullScreen")}>
                            <Button
                                variant="ghost"
                                size="icon-compact"
                                aria-label={t("builder.page.fullScreen")}
                                aria-pressed={layout.fullScreen}
                                onClick={() => setLayout({fullScreen: !layout.fullScreen})}
                            >
                                {layout.fullScreen ? <ArrowsInSimple /> : <ArrowsOutSimple />}
                            </Button>
                        </SimpleTooltip>
                    </>
                )}
                <SimpleTooltip title={t("builder.page.hideOpenItems")}>
                    <Button
                        variant="ghost"
                        size="icon-compact"
                        aria-label={t("builder.page.hideOpenItems")}
                        onClick={() =>
                            phone
                                ? setPhonePane(false)
                                : setLayout({hidden: true, fullScreen: false})
                        }
                    >
                        <SidebarSimple className="-scale-x-100" />
                    </Button>
                </SimpleTooltip>
            </div>
            <div
                role="tabpanel"
                id={BUILDER_TAB_PANEL_ID}
                aria-labelledby={BUILDER_TAB_ID}
                className="min-h-0 flex-1"
            >
                {/* Only the active tab is mounted. */}
                <BuilderTabContent
                    key={builderTabKey(activeTab)}
                    tab={activeTab}
                    builderSaveToolCallId={tabs.activeSaveToolCallId}
                    builderSaveRevisionId={tabs.activeSaveRevisionId}
                    onSectionOpened={onSectionOpened}
                    guardRef={paneGuard}
                    builderSessionId={sessionId}
                    workspaceId={workspaceId}
                    projectId={projectId}
                />
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
                <div className="relative h-full min-h-0" data-testid="builder-page">
                    {/* One tree for every layout: a change of layout never remounts the chat. */}
                    <SplitPane
                        className="h-full"
                        paneSide="end"
                        paneSize={paneOpen && !paneFull ? (dragWidth ?? layout.width) : 0}
                        paneMin={paneOpen && !paneFull ? PANE_MIN_WIDTH : 0}
                        paneMax={PANE_MAX_WIDTH}
                        fillMin={paneOpen && !paneFull ? CHAT_MIN_WIDTH : 0}
                        resizable={paneOpen && !paneFull}
                        barHidden={!paneOpen || paneFull}
                        paneGrow={paneFull}
                        onResize={(size) => setDragWidth(size)}
                        onResizeEnd={(size) => {
                            setDragWidth(null)
                            setLayout({width: size})
                        }}
                        pane={pane}
                        paneClassName={paneOpen ? undefined : "hidden"}
                        fill={chatColumn}
                        fillClassName={paneFull ? "hidden" : undefined}
                    />
                    <div
                        ref={setDialogHost}
                        className="pointer-events-none absolute inset-0 z-50 [contain:layout]"
                    />
                </div>
            </AppShell>
            {/* The automation, catalog and run history drawers the pane's views open. */}
            <SessionWorkspaceDrawers workspaceId={workspaceId} projectId={projectId} />
        </>
    )
}
