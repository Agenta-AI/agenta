import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

import {chatAge, type BuilderChatRow} from "./openRule"

/** "3d": the age of a chat by its last activity. */
export const useChatAgeLabel = () => {
    const t = useT(builderPanelCatalog)
    return (updatedAt: string | null | undefined, now: number) => {
        const age = chatAge(updatedAt, now)
        if (!age) return ""
        const value = String(age.count)
        if (age.unit === "minute") return t("builder.panel.ageMinutes", {value})
        if (age.unit === "hour") return t("builder.panel.ageHours", {value})
        return t("builder.panel.ageDays", {value})
    }
}

/** One chat in "Recent chats" and "Chat history": its title and age. */
export const ChatRow = ({
    row,
    now,
    onOpen,
}: {
    row: BuilderChatRow
    now: number
    onOpen: (sessionId: string) => void
}) => {
    const t = useT(builderPanelCatalog)
    const age = useChatAgeLabel()
    return (
        <button
            type="button"
            data-testid="builder-chat-row"
            onClick={() => onOpen(row.session_id)}
            className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[13px] text-colorText hover:bg-colorFillTertiary"
        >
            <span className="min-w-0 flex-1 truncate">
                {row.name?.trim() || t("builder.panel.untitledChat")}
            </span>
            <span className="shrink-0 text-xs text-colorTextTertiary">
                {age(row.updated_at, now)}
            </span>
        </button>
    )
}

/** One line and "Try again", for a list that could not load. */
export const ChatListFailed = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(builderPanelCatalog)
    return (
        <p className="m-0 flex items-center gap-2 px-2 py-1.5 text-xs text-colorTextSecondary">
            {t("builder.panel.listFailed")}
            <button
                type="button"
                onClick={onRetry}
                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorText underline underline-offset-2"
            >
                {t("builder.panel.tryAgain")}
            </button>
        </p>
    )
}

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
}: {
    rows: readonly BuilderChatRow[]
    failed: boolean
    onRetry: () => void
    onOpen: (sessionId: string) => void
    onViewAll: () => void
}) => {
    const t = useT(builderPanelCatalog)
    const now = Date.now()
    if (!failed && rows.length === 0) return null
    return (
        <div className="flex flex-col gap-0.5" data-testid="builder-recent-chats">
            <div className="flex items-center px-2 pb-1 text-xs text-colorTextSecondary">
                <span className="flex-1">{t("builder.panel.recentChats")}</span>
                {failed ? null : (
                    <button
                        type="button"
                        onClick={onViewAll}
                        className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorText underline underline-offset-2"
                    >
                        {t("builder.panel.viewAll")}
                    </button>
                )}
            </div>
            {failed ? (
                <ChatListFailed onRetry={onRetry} />
            ) : (
                rows
                    .slice(0, 3)
                    .map((row) => (
                        <ChatRow key={row.session_id} row={row} now={now} onOpen={onOpen} />
                    ))
            )}
        </div>
    )
}
