import {useState} from "react"

import type {SessionRowVm} from "@agenta/sessions/row"
import {SessionCardList} from "@agenta/sessions-ui"
import {Button, Popover, PopoverContent, PopoverTrigger, SimpleTooltip} from "@agenta/ui/ui"
import {History} from "lucide-react"
import {useRouter} from "next/router"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

/**
 * The tab bar's session history: a clock button beside the `+` that opens every session for this
 * agent, so one that is not currently a chip is still one click away.
 *
 * The desktop carries the same control in the same slot. It is NOT a port of that component: the
 * desktop's list is bound to its per-scope TAB store (open tabs vs closed history), which this app
 * has no equivalent of — sessions are routes here. What both surfaces genuinely share is the list
 * itself, so this is the shared `SessionCardList` in a popover, with the same rows, pins, status
 * dots and context-menu verbs the pane and the sessions page already render.
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
            <SimpleTooltip title="Session history">
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Session history"
                        className="h-7 w-7 shrink-0 p-0"
                    >
                        <History size={14} />
                    </Button>
                </PopoverTrigger>
            </SimpleTooltip>
            <PopoverContent align="end" className="flex w-[320px] flex-col gap-1 p-2">
                <span className="px-2 pt-1 text-xs font-medium">Session history</span>
                {/* Capped and scrolled: the strip already shows the recent ones, so this is the
                    tail, and an agent with a hundred sessions must not grow the popover. */}
                <div className="ag-scroll-quiet max-h-[320px] min-h-0 overflow-y-auto">
                    <SessionCardList
                        agentId={agentId ?? undefined}
                        policy={{origin: "exclude-trigger", expansions: []}}
                        limit={30}
                        withPinned
                        alwaysShowPin
                        emptyText="No sessions with this agent yet."
                        onOpenRow={openRow}
                        menuFor={menu.menuFor}
                        onMenuSelect={menu.onMenuSelect}
                    />
                </div>
            </PopoverContent>
        </Popover>
    )
}
