import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {SearchInput, SkeletonRows} from "@agenta/ui/ui"

import {cn} from "@/lib/utils"

import {ChatListFailed} from "./ChatListFailed"
import {ChatRow} from "./ChatRow"
import type {BuilderChatRow} from "./useBuilderChatList"

/** What "Chat history" shows, for a list in any state. */
export interface ChatHistoryListProps {
    rows: readonly BuilderChatRow[]
    pending: boolean
    failed: boolean
    /** The search the rows answer. */
    search: string
    onSearch: (search: string) => void
    onRetry: () => void
    onOpen: (sessionId: string) => void
    /** On a phone (M06): rows of 56 px with a line under each, edge to edge. */
    phone?: boolean
}

/** The search field and the rows of "Chat history", newest first. */
export const ChatHistoryList = ({
    rows,
    pending,
    failed,
    search,
    onSearch,
    onRetry,
    onOpen,
    phone = false,
}: ChatHistoryListProps) => {
    const t = useT(builderPanelCatalog)
    const now = Date.now()

    let body
    if (pending)
        body = phone ? (
            // The phone rows are 56 px with no gap between them (M06).
            <SkeletonRows count={6} className="gap-0 px-4" rowClassName="my-2 h-10 rounded-md" />
        ) : (
            <SkeletonRows count={6} rowClassName="h-8 rounded-md" />
        )
    else if (failed) body = <ChatListFailed onRetry={onRetry} />
    else if (rows.length === 0)
        body = (
            <p className="m-0 px-2 py-1.5 text-xs text-colorTextSecondary">
                {search.trim() ? t("builder.panel.noChatMatches") : t("builder.panel.noChatsYet")}
            </p>
        )
    else
        body = (
            <>
                {rows.map((row) => (
                    <ChatRow
                        key={row.session_id}
                        row={row}
                        now={now}
                        onOpen={onOpen}
                        layout={phone ? "phoneHistory" : "panel"}
                    />
                ))}
            </>
        )

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="builder-chat-history">
            <div className={cn("shrink-0", phone ? "px-4 pt-3 pb-1" : "px-4 pt-3 pb-2")}>
                <SearchInput
                    value={search}
                    onChange={(event) => onSearch(event.target.value)}
                    placeholder={t("builder.panel.searchChats")}
                    aria-label={t("builder.panel.searchChats")}
                    // On a phone the input fills the field, so the input itself is 44 px high
                    // (46 px less the border), for the 44 px tap rule. M06 draws no clear button.
                    allowClear={!phone}
                    className={cn(
                        "border-colorBorderSecondary",
                        phone
                            ? "h-[46px] items-stretch py-0 text-[15px]"
                            : "h-[30px] rounded-[6px] text-[13px] md:text-[13px]",
                    )}
                />
            </div>
            <div
                className={cn(
                    "ag-scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto",
                    phone ? "pb-3" : "gap-px px-2 pb-3",
                )}
            >
                {body}
            </div>
        </div>
    )
}
