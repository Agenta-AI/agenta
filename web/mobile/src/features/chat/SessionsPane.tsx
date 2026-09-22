import type {SessionRowVm} from "@agenta/sessions/row"
import {SessionCardList, SessionListSkeleton} from "@agenta/sessions-ui"
import {Button} from "@agenta/ui/ui"
import {Plus} from "lucide-react"
import {useRouter} from "next/router"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {useStartBlankSession} from "./useStartBlankSession"

/**
 * Chat's left pane: this agent's sessions.
 *
 * The desktop shows exactly this beside the transcript in Chat mode — the config panel collapses
 * and the rail takes its place, so the pane is never empty. Rows are the SHARED session cards, so
 * they carry the same titles, status dots, pins and context menu as every other list.
 */
export const SessionsPane = ({
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
    const startBlank = useStartBlankSession(base)

    const open = (vm: SessionRowVm) => {
        if (vm.id === activeSessionId) return
        void router.push(`${base}/sessions/${vm.id}`)
    }

    return (
        <div className="ag-panel-raised flex h-full min-h-0 w-full flex-col overflow-hidden">
            <div className="border-colorBorderSecondary flex h-[48px] shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
                <span className="text-colorText text-[13px] font-semibold">Sessions</span>
                {/* Starting a session needs an agent to start it with. */}
                {agentId ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="New session"
                        onClick={() => startBlank(agentId)}
                        // Negative margin keeps the 48px header's rhythm as the bare glyph did.
                        className="text-colorTextSecondary hover:text-colorText -m-1.5"
                    >
                        <Plus />
                    </Button>
                ) : null}
            </div>
            <div className="ag-scroll-quiet min-h-0 flex-1 overflow-y-auto px-2">
                {/* Not mounted until the agent is known. With `agentId` still null the list asked
                    for the whole project, then re-keyed and asked again the moment the agent
                    landed — every open cost two list reads and an aborted one. The agent now
                    resolves off the session header (~50 ms), so the skeleton is a blink. */}
                {agentId ? (
                    <SessionCardList
                        agentId={agentId}
                        policy={{origin: "exclude-trigger", expansions: []}}
                        limit={20}
                        withPinned
                        // Beside the transcript, not the screen's point: its reads queue behind it.
                        lowPriority
                        alwaysShowPin
                        emptyText="No sessions with this agent yet."
                        onOpenRow={open}
                        menuFor={menu.menuFor}
                        onMenuSelect={menu.onMenuSelect}
                        onRenameRow={menu.onRenameRow}
                    />
                ) : (
                    <SessionListSkeleton rows={6} />
                )}
            </div>
        </div>
    )
}
