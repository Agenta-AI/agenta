import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

import {cn} from "@/lib/utils"

import {ChatListFailed} from "./ChatListFailed"
import {ChatRow} from "./ChatRow"
import type {BuilderChatRow} from "./useBuilderChatList"

/** Rows under "Recent chats". */
export const RECENT_CHATS = 3

/**
 * "Recent chats" under a new chat: the three newest chats about this agent, and "View all". No
 * stored chat: nothing.
 */
export const RecentChats = ({
    rows,
    failed,
    onRetry,
    onOpen,
    onViewAll,
    phone = false,
}: {
    rows: readonly BuilderChatRow[]
    failed: boolean
    onRetry: () => void
    onOpen: (sessionId: string) => void
    onViewAll: () => void
    /** On a phone (M04): 44 px rows and a 44 px hit area on "View all". */
    phone?: boolean
}) => {
    const t = useT(builderPanelCatalog)
    const now = Date.now()
    if (!failed && rows.length === 0) return null
    return (
        <div className="flex flex-col gap-px" data-testid="builder-recent-chats">
            <div
                className={cn(
                    "flex items-center text-colorTextSecondary",
                    // The 44 px hit area of "View all" reaches 14 px below the line: the gap
                    // keeps it off the first row.
                    phone ? "px-1 pb-3.5 text-[13px]" : "px-2 pb-1 text-[12px] leading-5",
                )}
            >
                <span className="flex-1">{t("builder.panel.recentChats")}</span>
                {failed ? null : (
                    <button
                        type="button"
                        onClick={onViewAll}
                        className={cn(
                            "cursor-pointer border-0 bg-transparent font-medium text-colorText underline underline-offset-2",
                            phone
                                ? "relative p-0 text-[13px] after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']"
                                : "-mr-1.5 rounded-[6px] px-1.5 py-0.5 text-[12px] leading-5 hover:bg-accent",
                        )}
                    >
                        {t("builder.panel.viewAll")}
                    </button>
                )}
            </div>
            {failed ? (
                <ChatListFailed onRetry={onRetry} />
            ) : (
                rows
                    .slice(0, RECENT_CHATS)
                    .map((row) => (
                        <ChatRow
                            key={row.session_id}
                            row={row}
                            now={now}
                            onOpen={onOpen}
                            layout={phone ? "phoneRecent" : "panel"}
                        />
                    ))
            )}
        </div>
    )
}
