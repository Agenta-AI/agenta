import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ArrowLeft, ArrowsOut, CaretDown, Hammer, Plus, X} from "@phosphor-icons/react"
import Link from "next/link"

import {cn} from "@/lib/utils"

import type {BuilderChatRow} from "./useBuilderChatList"
import {useChatAgeLabel} from "./useChatAgeLabel"

/** Chats in the title menu. */
export const TITLE_MENU_CHATS = 5

const headerClass =
    "flex h-12 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-2"

/**
 * The builder panel header: the chat title as a menu of the latest chats about this agent and
 * "Chat history", or the back arrow of the history; then "+", "Open in the builder" and close.
 * On a phone (M04, M06) the builder is already full screen: the phone header has the back arrow
 * (to the session, or from the history to the chat), the title menu and "+", with no "Open in
 * the builder" and no close.
 */
export const BuilderHeader = ({
    title,
    isHistory,
    menuRows,
    onBack,
    onOpenChat,
    onOpenHistory,
    onNewChat,
    openInBuilderHref,
    onClose,
    phone = false,
    backTitle,
}: {
    title: string
    /** The history shows: a back arrow and "Chat history" take the title's place. */
    isHistory: boolean
    menuRows: readonly BuilderChatRow[]
    onBack: () => void
    onOpenChat: (sessionId: string) => void
    onOpenHistory: () => void
    onNewChat: () => void
    /** Null while the panel picks the chat. */
    openInBuilderHref: string | null
    onClose: () => void
    /** The builder covers a phone screen: the phone header, with 44 px controls. */
    phone?: boolean
    /** On a phone, the screen the back arrow of the chat returns to ("Session"). */
    backTitle?: string
}) => {
    const t = useT(builderPanelCatalog)
    const age = useChatAgeLabel()
    const now = Date.now()
    const iconButton = (label: string, icon: ReactNode, onClick: () => void) => (
        <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            onClick={onClick}
            className="shrink-0"
        >
            {icon}
        </Button>
    )
    const titleMenu = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    data-testid="builder-chat-title"
                    className={cn(
                        "flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent font-semibold text-colorText hover:bg-colorFillTertiary",
                        phone ? "h-11 rounded-lg px-2 text-base" : "h-8 rounded-md px-2 text-sm",
                    )}
                >
                    <Hammer aria-hidden size={14} className="shrink-0" />
                    <span className="min-w-0 truncate" title={title}>
                        {title}
                    </span>
                    <CaretDown aria-hidden size={12} className="shrink-0 text-colorTextTertiary" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
                {menuRows.map((row) => (
                    <DropdownMenuItem
                        key={row.session_id}
                        onSelect={() => onOpenChat(row.session_id)}
                        className={cn("gap-2", phone && "min-h-11")}
                    >
                        <span className="min-w-0 flex-1 truncate">
                            {row.name?.trim() || t("builder.panel.untitledChat")}
                        </span>
                        <span className="shrink-0 text-xs text-colorTextTertiary">
                            {age(row.updated_at, now)}
                        </span>
                    </DropdownMenuItem>
                ))}
                {menuRows.length ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onSelect={onOpenHistory} className={cn(phone && "min-h-11")}>
                    {t("builder.panel.chatHistory")}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
    if (phone) {
        const newChat = (
            <button
                type="button"
                aria-label={t("builder.panel.newChat")}
                title={t("builder.panel.newChat")}
                onClick={onNewChat}
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-colorText active:bg-colorFillTertiary"
            >
                <Plus aria-hidden size={20} />
            </button>
        )
        return isHistory ? (
            <PhoneScreenHeader
                title={t("builder.panel.chatHistory")}
                onBack={onBack}
                backTitle={t("builder.panel.chat")}
                trailing={newChat}
            />
        ) : (
            <PhoneScreenHeader
                title={titleMenu}
                onBack={onClose}
                backTitle={backTitle}
                trailing={newChat}
            />
        )
    }
    return (
        <div className={headerClass} data-testid="builder-panel-header">
            {isHistory ? (
                <>
                    {iconButton(t("builder.panel.back"), <ArrowLeft aria-hidden />, onBack)}
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {t("builder.panel.chatHistory")}
                    </span>
                </>
            ) : (
                <div className="flex min-w-0 flex-1">{titleMenu}</div>
            )}
            {iconButton(t("builder.panel.newChat"), <Plus aria-hidden />, onNewChat)}
            {openInBuilderHref ? (
                <Button
                    asChild
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label={t("builder.panel.openInBuilder")}
                    title={t("builder.panel.openInBuilder")}
                >
                    <Link href={openInBuilderHref} data-testid="builder-open-in-builder">
                        <ArrowsOut aria-hidden />
                    </Link>
                </Button>
            ) : null}
            {iconButton(t("builder.panel.close"), <X aria-hidden />, onClose)}
        </div>
    )
}
