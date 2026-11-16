import {useState} from "react"

import {useT} from "@agenta/i18n"
import chatMobileSessionsCatalog from "@agenta/i18n/catalogs/chat.mobileSessions"
import type {SessionRowVm} from "@agenta/sessions/row"
import {SessionCardList} from "@agenta/sessions-ui"
import {Button, Popover, PopoverContent, PopoverTrigger, SimpleTooltip} from "@agenta/ui/ui"
import {ChatsCircleIcon} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

/**
 * The tab bar's session history: a clock button beside the `+` that opens every session for this
 * agent, so one that is not currently a chip is still one click away.
 *
 * Sessions are routes here, so this is the shared `SessionCardList` in a popover, with the same
 * rows, pins, status dots and context-menu verbs the pane and the sessions page already render.
 */
export const SessionHistoryMenu = ({
    agentId,
    base,
    activeSessionId,
}: {
    /** Scope to this agent's sessions. Absent while the session's agent is still resolving. */
    agentId?: string | null
    /** `/w/:workspace/p/:project` */
    base: string
    activeSessionId: string
}) => {
    const t = useT(chatMobileSessionsCatalog)
    const router = useRouter()
    const menu = useSessionRowMenu(base)
    const [open, setOpen] = useState(false)

    const openRow = (vm: SessionRowVm) => {
        setOpen(false)
        if (vm.id === activeSessionId) return
        void router.push(`${base}/sessions/${vm.id}`)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <SimpleTooltip title={t("chat.mobileSessions.sessionHistory")}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("chat.mobileSessions.sessionHistory")}
                        className="h-7 w-7 shrink-0 p-0"
                    >
                        {/* The rail's own Sessions glyph, so the button reads as that list. */}
                        <ChatsCircleIcon size={14} />
                    </Button>
                </PopoverTrigger>
            </SimpleTooltip>
            <PopoverContent align="end" className="flex w-[320px] flex-col gap-1 p-2">
                <span className="px-3 pt-1 text-xs font-medium">
                    {t("chat.mobileSessions.sessionHistory")}
                </span>
                {/* Capped and scrolled: the strip already shows the recent ones, so this is the
                    tail, and an agent with a hundred sessions must not grow the popover. */}
                {/* The surface is restated here, not left to PopoverContent, because the sticky
                    group headings paint `bg-inherit` and need something to inherit FROM. Same
                    token the popover itself uses, so it is the same surface either way. */}
                <div className="ag-scroll-quiet bg-popover max-h-[320px] min-h-0 overflow-y-auto">
                    <SessionCardList
                        agentId={agentId ?? undefined}
                        policy={{origin: "exclude-trigger", expansions: []}}
                        limit={30}
                        withPinned
                        // The rail's one-line rows, so the popover reads as the sidebar does —
                        // the time kept, the subtitle dropped, the pin on hover beside the name.
                        density="compact"
                        activeRowId={activeSessionId}
                        emptyText={t("chat.mobileSessions.noSessions")}
                        onOpenRow={openRow}
                        menuFor={menu.menuFor}
                        onMenuSelect={menu.onMenuSelect}
                        onRenameRow={menu.onRenameRow}
                    />
                </div>
            </PopoverContent>
        </Popover>
    )
}
