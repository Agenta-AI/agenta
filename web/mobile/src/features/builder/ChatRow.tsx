import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

import type {BuilderChatRow} from "./useBuilderChatList"
import {useChatAgeLabel} from "./useChatAgeLabel"

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
