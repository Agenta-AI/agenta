import {useState} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {sessionRowVm} from "@agenta/sessions/row"
import {Button, MENU_ITEM, Popover, PopoverContent, PopoverTrigger, Spinner} from "@agenta/ui/ui"
import {CaretUpDown, Circle, Plus} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import type {PaneSessionPick} from "./PaneSessions"

/** A session's status mark and title, as the session rows show them. */
const sessionLabel = (session: SessionStream) => {
    const vm = sessionRowVm(session, {pinned: false, pending: undefined})
    return (
        <>
            {vm.status.status === "running" ? (
                <Spinner className="size-3 shrink-0" />
            ) : (
                <Circle aria-hidden size={12} className="shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{vm.title}</span>
        </>
    )
}

/**
 * The Sessions pane tab's own row under the tabs (B07, B08): the session picker at full width
 * and "New session", which shows a blank session of this agent in the pane.
 */
export const PaneSessionBar = ({pick}: {pick: PaneSessionPick}) => {
    const t = useT(builderPageCatalog, agentSidebarCatalog)
    const [open, setOpen] = useState(false)
    const current = pick.session
    return (
        <div
            data-testid="pane-session-bar"
            className="flex h-11 shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted bg-muted px-3"
        >
            {current ? (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            data-testid="pane-session-switcher"
                            className="focus-ring box-border flex h-control-sm min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-solid border-border bg-background px-2 text-left text-label text-foreground hover:bg-[image:linear-gradient(var(--accent),var(--accent))]"
                        >
                            {sessionLabel(current)}
                            <CaretUpDown
                                aria-hidden
                                size={14}
                                className="shrink-0 text-muted-foreground"
                            />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        aria-label={t("builder.page.sessions")}
                        className="flex max-h-90 w-[var(--radix-popover-trigger-width)] min-w-70 flex-col overflow-y-auto p-1"
                    >
                        {pick.sessions.map((row) => (
                            <button
                                key={row.session_id}
                                type="button"
                                aria-current={row.session_id === current.session_id || undefined}
                                onClick={() => {
                                    pick.pick(row.session_id)
                                    setOpen(false)
                                }}
                                className={cn(
                                    MENU_ITEM,
                                    "shrink-0 border-0 bg-transparent text-left text-foreground hover:bg-accent focus-visible:bg-accent",
                                    row.session_id === current.session_id && "bg-selected",
                                )}
                            >
                                {sessionLabel(row)}
                            </button>
                        ))}
                    </PopoverContent>
                </Popover>
            ) : null}
            <Button
                variant="outline"
                size="compact"
                data-testid="pane-new-session"
                aria-label={t("agentSidebar.newSession")}
                onClick={pick.startNew}
                className="ml-auto"
            >
                <Plus aria-hidden data-icon="inline-start" size={14} />
                <span className="max-md:hidden">{t("agentSidebar.newSession")}</span>
                <span className="md:hidden">{t("builder.page.newSessionShort")}</span>
            </Button>
        </div>
    )
}
