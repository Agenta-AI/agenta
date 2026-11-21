import {useState} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {sessionRowVm} from "@agenta/sessions/row"
import {Button, Popover, PopoverContent, PopoverTrigger, Spinner} from "@agenta/ui/ui"
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
                <Circle aria-hidden size={12} className="shrink-0 text-colorTextSecondary" />
            )}
            <span className="min-w-0 flex-1 truncate">{vm.title}</span>
        </>
    )
}

// On a phone (B08) the controls are 36 px high with 14 px text, and a 44 px tap area.
const phoneControl =
    "max-md:relative max-md:h-9 max-md:rounded-[8px] max-md:text-[14px] max-md:after:absolute max-md:after:inset-[-4px] max-md:after:content-['']"

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
            className="flex h-11 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary bg-[var(--ag-surface-raised)] px-3 max-md:h-12"
        >
            {current ? (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            data-testid="pane-session-switcher"
                            className={cn(
                                "box-border flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[6px] border border-solid border-colorBorder bg-colorBgContainer pl-2.5 pr-2 text-left text-[13px] font-medium leading-5 text-colorText hover:bg-muted",
                                phoneControl,
                            )}
                        >
                            {sessionLabel(current)}
                            <CaretUpDown
                                aria-hidden
                                size={14}
                                className="shrink-0 text-colorTextTertiary"
                            />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        aria-label={t("builder.page.sessions")}
                        className="flex max-h-[360px] w-[var(--radix-popover-trigger-width)] min-w-[280px] flex-col overflow-y-auto p-1"
                    >
                        {(pick.query.data?.sessions ?? []).map((row) => (
                            <button
                                key={row.session_id}
                                type="button"
                                aria-current={row.session_id === current.session_id || undefined}
                                onClick={() => {
                                    pick.pick(row.session_id)
                                    setOpen(false)
                                }}
                                className={cn(
                                    "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[13px] text-colorText hover:bg-colorFillTertiary max-md:h-11",
                                    row.session_id === current.session_id &&
                                        "bg-colorFillSecondary",
                                )}
                            >
                                {sessionLabel(row)}
                            </button>
                        ))}
                    </PopoverContent>
                </Popover>
            ) : (
                <span className="flex-1" />
            )}
            <Button
                variant="outline"
                size="compact"
                data-testid="pane-new-session"
                aria-label={t("agentSidebar.newSession")}
                onClick={pick.startNew}
                className={phoneControl}
            >
                <Plus aria-hidden data-icon="inline-start" size={14} />
                <span className="max-md:hidden">{t("agentSidebar.newSession")}</span>
                <span className="md:hidden">{t("builder.page.newSessionShort")}</span>
            </Button>
        </div>
    )
}
