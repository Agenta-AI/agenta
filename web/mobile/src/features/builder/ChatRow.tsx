import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

import {cn} from "@/lib/utils"

import type {BuilderChatRow} from "./useBuilderChatList"
import {useChatAgeLabel} from "./useChatAgeLabel"

/**
 * One chat in "Recent chats" and "Chat history": its title and age. On a phone a recent chat is a
 * 44 px row (M04), and a history row is 56 px with a line under it (M06).
 */
export const ChatRow = ({
    row,
    now,
    onOpen,
    layout = "panel",
}: {
    row: BuilderChatRow
    now: number
    onOpen: (sessionId: string) => void
    /** Where the row shows: the desktop panel, the phone "Recent chats", the phone history. */
    layout?: "panel" | "phoneRecent" | "phoneHistory"
}) => {
    const t = useT(builderPanelCatalog)
    const age = useChatAgeLabel()
    return (
        <button
            type="button"
            data-testid="builder-chat-row"
            onClick={() => onOpen(row.session_id)}
            className={cn(
                "flex w-full min-w-0 cursor-pointer items-center border-0 bg-transparent text-left text-colorText hover:bg-colorFillTertiary",
                layout === "panel" && "h-8 gap-2 rounded-md px-2 text-[13px]",
                layout === "phoneRecent" && "h-11 shrink-0 gap-2 rounded-md px-1 text-[15px]",
                layout === "phoneHistory" &&
                    "min-h-14 shrink-0 gap-3 border-b border-solid border-colorBorderSecondary py-1.5 pl-4 pr-2 text-[15px]",
            )}
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
