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
import {ArrowClockwiseIcon, CircleIcon, PlusIcon, SparkleIcon} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {DrawerProjectSwitcher} from "../nav/DrawerProjectSwitcher"
import {useMobileBottomNavItems} from "../nav/useMobileNavItems"

import {chatDayLabel} from "./chatDayLabel"
import {useBuilderChats} from "./useBuilderChats"

const ROW =
    "flex w-full shrink-0 items-center border-0 border-b border-solid border-[var(--ag-shell-line)]"

export const builderChatRowKey = (sessionId: string) => `builder-chat-${sessionId}`
const NEW_CHAT_KEY = "builder-new-chat"

/**
 * The builder sidebar (B01): Back, "Builder", "New chat" and "Chats", the person's builder chats
 * newest first with the day of their last message. "Back" shows the main sidebar and leaves the
 * page as it is.
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
        const selectedKeyOverride = sessionId ? builderChatRowKey(sessionId) : NEW_CHAT_KEY
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
                        : createElement(CircleIcon, {size: 8}),
                    suffix: createElement(
                        "span",
                        {className: "text-xs text-colorTextTertiary"},
                        chatDayLabel(row.updated_at, now, words),
                    ),
                    link: `${projectURL}/builder/${encodeURIComponent(row.session_id)}`,
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
                            key: NEW_CHAT_KEY,
                            title: t("builder.page.newChat"),
                            icon: createElement(PlusIcon, {size: 16}),
                            link: `${projectURL}/builder`,
                            matchLinks: [],
                        },
                        {
                            key: "builder-chats",
                            title: t("builder.page.chats"),
                            alwaysOpen: true,
                            scrollChildren: true,
                            hideChildrenWhenCollapsed: true,
                            onReachEnd: chats.loadMore,
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
        const back = <SidebarBackButton collapsed={collapsed} onBack={onBack} />
        const toggle = <SidebarToggleButton onDismiss={onDismiss} />
        return (
            <>
                <div
                    className={`${ROW} h-[45px] ${collapsed ? "justify-center" : "justify-between px-1.5"}`}
                >
                    {collapsed ? toggle : back}
                    {!collapsed && toggle}
                </div>
                {collapsed && <div className={`${ROW} h-[45px] justify-center`}>{back}</div>}
                <div
                    className={`${ROW} min-h-[52px] gap-2 ${collapsed ? "justify-center" : "px-3"}`}
                >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-colorFillTertiary text-colorText">
                        <SparkleIcon aria-hidden size={16} />
                    </span>
                    {collapsed ? null : (
                        <span className="truncate text-sm font-medium text-colorText">
                            {t("builder.page.builder")}
                        </span>
                    )}
                </div>
            </>
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
