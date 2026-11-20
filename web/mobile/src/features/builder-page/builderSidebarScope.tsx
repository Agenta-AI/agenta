import {createElement, useMemo} from "react"

import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SidebarBackButton, SidebarToggleButton} from "@agenta/navigation-ui"
import {Spinner} from "@agenta/ui/ui"
import {ArrowClockwiseIcon} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {AgentSidebarHeader} from "../agent-sidebar/AgentSidebarHeader"
import {sessionBullet} from "../agent-sidebar/agentSidebarItems"
import {ConnectedAgentSwitcher} from "../agent-sidebar/ConnectedAgentSwitcher"
import {SidebarNewButton} from "../agent-sidebar/SidebarNewButton"
import {builderChatHref} from "../builder/builderChatHref"
import {DrawerProjectSwitcher} from "../nav/DrawerProjectSwitcher"
import {useMobileBottomNavItems} from "../nav/useMobileNavItems"

import {BuilderChatSearch} from "./BuilderChatSearch"
import {chatDayLabel} from "./chatDayLabel"
import {useBuilderChats} from "./useBuilderChats"

export const builderChatRowKey = (sessionId: string) => `builder-chat-${sessionId}`

/**
 * The builder sidebar (B01): Back, the switcher on "Builder", "New chat" and "Chats", the
 * person's builder chats newest first with the day of their last message. "Back" shows the main
 * sidebar and leaves the page as it is. The search button next to "Chats" opens the search
 * window over the builder chats.
 */
export const createBuilderSidebarScope = (
    workspaceId: string,
    projectId: string,
    onBack: () => void,
): SidebarScope => {
    const projectURL = `/w/${workspaceId}/p/${projectId}`

    const useSelection = (): SidebarSelection => {
        const router = useRouter()
        const chat = router.query.chat
        const sessionId = Array.isArray(chat) ? chat[0] : undefined
        // A new chat marks no row: "New chat" is a button, not a place.
        const selectedKeyOverride = sessionId ? builderChatRowKey(sessionId) : undefined
        return useMemo(() => ({mode: "route", selectedKeyOverride}), [selectedKeyOverride])
    }

    const useSections = (): SidebarSection[] => {
        const t = useT(builderPageCatalog)
        const bottomItems = useMobileBottomNavItems(projectURL)
        const chats = useBuilderChats()
        return useMemo(() => {
            const now = new Date()
            const words = {today: t("builder.page.today"), yesterday: t("builder.page.yesterday")}
            const rows = chats.rows.map((row) => {
                const title = row.name?.trim() || t("builder.page.untitledChat")
                return {
                    key: builderChatRowKey(row.session_id),
                    title,
                    tooltip: title,
                    icon: row.flags?.is_running
                        ? createElement(Spinner, {className: "size-3"})
                        : sessionBullet("idle"),
                    suffix: createElement(
                        "span",
                        {className: "text-[12px] leading-4 text-colorTextSecondary"},
                        chatDayLabel(row.updated_at, now, words),
                    ),
                    link: builderChatHref({workspaceId, projectId, sessionId: row.session_id}),
                    prefetch: false,
                }
            })
            const states =
                chats.rows.length > 0
                    ? []
                    : chats.failed
                      ? [
                            {
                                key: "builder-chats-error",
                                title: t("builder.page.chatsFailed"),
                                disabled: true,
                                isPlaceholder: true,
                            },
                            {
                                key: "builder-chats-retry",
                                title: t("builder.page.retry"),
                                icon: createElement(ArrowClockwiseIcon, {size: 16}),
                                onClick: chats.retry,
                            },
                        ]
                      : chats.pending
                        ? [
                              {
                                  key: "builder-chats-loading",
                                  title: t("builder.page.chatsLoading"),
                                  disabled: true,
                                  isLoading: true,
                              },
                          ]
                        : []
            return [
                {
                    key: "builder",
                    items: [
                        {
                            key: "builder-chats",
                            title: t("builder.page.chats"),
                            // Always open with no icon: the rail draws it as a small heading.
                            rowClassName: "pt-2.5",
                            alwaysOpen: true,
                            scrollChildren: true,
                            hideChildrenWhenCollapsed: true,
                            onReachEnd: chats.loadMore,
                            // The search window over every builder chat (B06). No filter.
                            groupAction: createElement(BuilderChatSearch, {
                                workspaceId,
                                projectId,
                            }),
                            submenu: [...rows, ...states],
                        },
                    ],
                },
                {key: "bottom", items: bottomItems, placement: "bottom", mode: "vertical"},
            ]
        }, [bottomItems, chats, t])
    }

    const Header = ({collapsed, onDismiss}: SidebarSlotContext) => {
        const t = useT(builderPageCatalog)
        return (
            <AgentSidebarHeader
                collapsed={collapsed}
                back={<SidebarBackButton collapsed={collapsed} onBack={onBack} />}
                toggle={<SidebarToggleButton onDismiss={onDismiss} />}
                switcher={
                    <ConnectedAgentSwitcher
                        projectURL={projectURL}
                        projectId={projectId}
                        current={{kind: "builder"}}
                        collapsed={collapsed}
                    />
                }
                newSession={
                    <SidebarNewButton
                        label={t("builder.page.newChat")}
                        href={`${projectURL}/builder`}
                        collapsed={collapsed}
                    />
                }
            />
        )
    }

    const AfterBottom = ({collapsed}: {collapsed: boolean}) => (
        <DrawerProjectSwitcher
            workspaceId={workspaceId}
            projectId={projectId}
            collapsed={collapsed}
        />
    )

    return {
        id: "builder-sidebar",
        useSelection,
        useSections,
        header: Header,
        afterBottom: AfterBottom,
    }
}
