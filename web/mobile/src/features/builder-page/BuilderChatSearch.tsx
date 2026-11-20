import {createElement, useEffect, useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {CommandPalette, type CommandPaletteGroup} from "@agenta/navigation-ui"
import {Spinner} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {sessionBullet} from "../agent-sidebar/agentSidebarItems"
import {builderChatHref} from "../builder/builderChatHref"

import {chatDayLabel} from "./chatDayLabel"
import {useBuilderChats} from "./useBuilderChats"

/** The search waits this long after the last key: it is a server request. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The search window over the builder chats (B06): the production search window, opened from
 * the search button next to "Chats". It searches every builder chat by title on the server.
 * Mounted only while open, so each opening starts with an empty field.
 */
const BuilderChatSearchWindow = ({
    workspaceId,
    projectId,
    onOpenChange,
}: {
    workspaceId: string
    projectId: string
    onOpenChange: (open: boolean) => void
}) => {
    const t = useT(builderPageCatalog, navigationCatalog)
    const router = useRouter()
    const [query, setQuery] = useState("")
    const [term, setTerm] = useState("")
    useEffect(() => {
        const timer = setTimeout(() => setTerm(query.trim()), SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [query])
    // With no term this is the sidebar's own list query, so opening the window sends nothing new.
    const chats = useBuilderChats(term)
    const groups = useMemo<CommandPaletteGroup[]>(() => {
        const now = new Date()
        const words = {today: t("builder.page.today"), yesterday: t("builder.page.yesterday")}
        return [
            {
                key: "builder-chats",
                // No heading: the window lists one kind of thing.
                heading: "",
                // The previous term's rows are not matches for this one.
                entries: (chats.stale ? [] : chats.rows).map((row) => ({
                    key: row.session_id,
                    label: row.name?.trim() || t("builder.page.untitledChat"),
                    icon: row.flags?.is_running
                        ? createElement(Spinner, {className: "size-3"})
                        : sessionBullet("idle"),
                    hint: chatDayLabel(row.updated_at, now, words),
                    href: builderChatHref({workspaceId, projectId, sessionId: row.session_id}),
                })),
            },
        ]
    }, [chats.rows, chats.stale, projectId, t, workspaceId])
    return (
        <CommandPalette
            open
            onOpenChange={onOpenChange}
            query={query}
            onQueryChange={setQuery}
            groups={groups}
            loading={chats.pending || chats.stale || term !== query.trim()}
            onNavigate={(href) => void router.push(href)}
            placeholder={t("navigation.items.searchChats")}
        />
    )
}

/** The search button at the right of the "Chats" heading, and the window it opens. */
export const BuilderChatSearch = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const t = useT(navigationCatalog)
    const [open, setOpen] = useState(false)
    return (
        <>
            <button
                type="button"
                aria-label={t("navigation.items.searchChats")}
                title={t("navigation.items.searchChats")}
                data-testid="builder-chats-search"
                onClick={() => setOpen(true)}
                // The glyph sits where the design puts it (12 px from the row's end), and the
                // 24 px target does not make the 20 px heading taller.
                className="-my-0.5 -mr-[5px] flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-colorTextSecondary [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText"
            >
                <MagnifyingGlassIcon size={14} />
            </button>
            {open ? (
                <BuilderChatSearchWindow
                    workspaceId={workspaceId}
                    projectId={projectId}
                    onOpenChange={setOpen}
                />
            ) : null}
        </>
    )
}
