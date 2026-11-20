import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {SearchInput, SkeletonRows} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"

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
            {/* A label, so a tap in the padding around the 40 px phone field still focuses it: the
                hit area is 44 px or more (tap rule), the field is drawn at the design's 40 px (M06). */}
            <label className={cn("block shrink-0", phone ? "px-4 pt-3 pb-1" : "px-4 pt-3 pb-2")}>
                <SearchInput
                    value={search}
                    onChange={(event) => onSearch(event.target.value)}
                    placeholder={t("builder.panel.searchChats")}
                    aria-label={t("builder.panel.searchChats")}
                    // Phone: no clear button (M06). The search glyph is tertiary (S09, M06).
                    prefix={<MagnifyingGlass size={14} className="text-colorTextTertiary" />}
                    allowClear={!phone}
                    className={cn(
                        "gap-2 border-colorBorderSecondary px-2",
                        phone
                            ? "h-10 items-stretch rounded-[8px] py-0 [&_input]:text-[15px]"
                            : "h-[30px] rounded-[6px] [&_input]:text-[13px] md:[&_input]:text-[13px]",
                    )}
                />
            </label>
            <div
                className={cn(
                    "ag-scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto",
                    // Desktop: the rows reach 2 px from the scrollbar gutter (S09).
                    phone ? "pb-3" : "gap-px pb-3 pl-2 pr-0.5",
                )}
            >
                {body}
            </div>
        </div>
    )
}
