import {useState} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {sessionRowVm} from "@agenta/sessions/row"
import {Popover, PopoverContent, PopoverTrigger, Spinner} from "@agenta/ui/ui"
import {CaretUpDown, Circle} from "@phosphor-icons/react"

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

/** The session switcher at the end of the pane sub-tab row (B04). */
export const PaneSessionSwitcher = ({pick}: {pick: PaneSessionPick}) => {
    const t = useT(builderPageCatalog)
    const [open, setOpen] = useState(false)
    const current = pick.session
    if (!current) return null
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid="pane-session-switcher"
                    aria-haspopup="listbox"
                    // 44 px high on a phone (tap rule).
                    className="box-border flex h-7 w-[172px] shrink-0 cursor-pointer items-center gap-2 rounded-[6px] border border-solid border-colorBorder bg-colorBgContainer pl-2.5 pr-2 text-left text-[13px] font-medium leading-5 text-colorText hover:bg-muted max-md:h-11 max-md:w-[140px]"
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
                align="end"
                aria-label={t("builder.page.sessions")}
                className="flex max-h-[360px] w-[280px] flex-col overflow-y-auto p-1"
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
                            row.session_id === current.session_id && "bg-colorFillSecondary",
                        )}
                    >
                        {sessionLabel(row)}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    )
}
