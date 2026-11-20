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
        <div className="flex flex-col gap-0.5" data-testid="builder-recent-chats">
            <div
                className={cn(
                    "flex items-center pb-1 text-colorTextSecondary",
                    phone ? "px-1 text-[13px]" : "px-2 text-xs",
                )}
            >
                <span className="flex-1">{t("builder.panel.recentChats")}</span>
                {failed ? null : (
                    <button
                        type="button"
                        onClick={onViewAll}
                        className={cn(
                            "cursor-pointer border-0 bg-transparent p-0 text-colorText underline underline-offset-2",
                            phone
                                ? "relative text-[13px] after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']"
                                : "text-xs",
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
                            size={phone ? "phone" : "panel"}
                        />
                    ))
            )}
        </div>
    )
}
