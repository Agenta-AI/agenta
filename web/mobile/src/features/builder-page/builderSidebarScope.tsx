import {createElement, useMemo} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SidebarBackButton, SidebarToggleButton} from "@agenta/navigation-ui"
import {ArrowClockwiseIcon, ChatsIcon, PlusIcon} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {AgentSidebarHeader} from "../agent-sidebar/AgentSidebarHeader"
import {ConnectedAgentSwitcher} from "../agent-sidebar/ConnectedAgentSwitcher"
import {dayGroupedRows} from "../agent-sidebar/dayGroups"
import {builderChatHref} from "../builder/builderChatHref"
import {sessionStatusMark, withStatusMark} from "../nav/sessionStatusMark"
import {useMobileBottomNavItems} from "../nav/useMobileNavItems"
import {CreditsRemainingWidget} from "../wallet/CreditsRemainingWidget"

import {BuilderChatSearch} from "./BuilderChatSearch"
import {useBuilderChats} from "./useBuilderChats"

export const builderChatRowKey = (sessionId: string) => `builder-chat-${sessionId}`

const BUILDER_NEW_CHAT_KEY = "builder-new-chat"

/** The builder sidebar, laid out as the agent sidebar: New chat, then the chats by day. */
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
        // No chat open: the page is a new chat, so "New chat" is the current row.
        const selectedKeyOverride = sessionId ? builderChatRowKey(sessionId) : BUILDER_NEW_CHAT_KEY
        return useMemo(() => ({mode: "route", selectedKeyOverride}), [selectedKeyOverride])
    }

    const useSections = (): SidebarSection[] => {
        const t = useT(builderPageCatalog, agentSidebarCatalog)
        const bottomItems = useMobileBottomNavItems(projectURL)
        const chats = useBuilderChats()
        return useMemo(() => {
            const rows = dayGroupedRows(chats.rows, {
                activityAt: (row) => row.updated_at ?? null,
                keyPrefix: "builder-chats-day",
                label: (key) => t(`agentSidebar.${key}`),
                toRow: (row) => {
                    const title = row.name?.trim() || t("builder.page.untitledChat")
                    return {
                        key: builderChatRowKey(row.session_id),
                        title,
                        tooltip: title,
                        // The state shows as a quiet mark on the right, as on the agent sidebar.
                        wrapRow: (node) =>
                            withStatusMark(
                                node,
                                sessionStatusMark(row.flags?.is_running ? "running" : null),
                            ),
                        link: builderChatHref({workspaceId, projectId, sessionId: row.session_id}),
                        prefetch: false,
                    }
                },
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
                        : [
                              {
                                  key: "builder-chats-empty",
                                  title: t("builder.page.noChatsYet"),
                                  disabled: true,
                                  isPlaceholder: true,
                              },
                          ]
            return [
                {
                    key: "builder",
                    items: [
                        {
                            key: BUILDER_NEW_CHAT_KEY,
                            title: t("builder.page.newChat"),
                            icon: createElement(PlusIcon, {size: 16}),
                            link: `${projectURL}/builder`,
                            matchLinks: [],
                            prefetch: false,
                        },
                    ],
                },
                {
                    key: "chats",
                    dividerBefore: true,
                    items: [
                        {
                            key: "builder-chats",
                            title: t("builder.page.chats"),
                            icon: createElement(ChatsIcon, {size: 16}),
                            alwaysOpen: true,
                            scrollChildren: true,
                            hideChildrenWhenCollapsed: true,
                            onReachEnd: chats.loadMore,
                            // The search window over every builder chat, on the server.
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
            />
        )
    }

    const Footer = ({collapsed}: SidebarSlotContext) => (
        <CreditsRemainingWidget
            projectId={projectId}
            settingsURL={`${projectURL}/settings`}
            collapsed={collapsed}
        />
    )

    return {
        id: "builder-sidebar",
        useSelection,
        useSections,
        header: Header,
        footer: Footer,
    }
}
