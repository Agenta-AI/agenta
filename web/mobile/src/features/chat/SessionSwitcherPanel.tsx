import {useCallback, useEffect, useState, type RefObject} from "react"

import type {SessionRowVm} from "@agenta/sessions/row"
import {useSessionCardList} from "@agenta/sessions/state"
import {SessionCardList} from "@agenta/sessions-ui"
import {useDebounceInput} from "@agenta/shared/hooks"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {MagnifyingGlassIcon, PlusIcon} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

const FOOTER_ROW =
    "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3 text-left text-sm text-foreground [font-family:inherit] hover:bg-accent"

const LIST_POLICY = {origin: "exclude-trigger", expansions: []} as const

/** This agent's sessions: search, the list, and New session. */
export const SessionSwitcherPanel = ({
    agentId,
    base,
    activeSessionId,
    onNew,
    onClose,
    searchRef,
}: {
    agentId?: string | null
    /** `/w/:workspace/p/:project` */
    base: string
    activeSessionId: string
    /** Omit where there is no agent to start a session with. */
    onNew?: () => void
    onClose: () => void
    /** The host decides when the search takes focus: a phone keeps its keyboard down. */
    searchRef?: RefObject<HTMLInputElement | null>
}) => {
    const router = useRouter()
    const menu = useSessionRowMenu(base)
    const [search, setSearch] = useState("")
    const [typed, setTyped] = useDebounceInput<string>(search, setSearch, 250, "")
    const listArgs = {
        agentId: agentId ?? undefined,
        policy: LIST_POLICY,
        limit: 30,
        withPinned: true,
    }
    const list = useSessionCardList({...listArgs, search})

    const openRow = useCallback(
        (vm: SessionRowVm) => {
            onClose()
            if (vm.id !== activeSessionId) void router.push(`${base}/sessions/${vm.id}`)
        },
        [activeSessionId, base, onClose, router],
    )

    // Enter can beat the search: it waits for the answer, so it never opens a row from before.
    const [enterQueued, setEnterQueued] = useState(false)
    const answered = typed === search && !list.isStale && !list.isPending
    const firstRow = list.groups.flatMap((group) => group.rows)[0]
    useEffect(() => {
        if (!enterQueued || !answered) return
        setEnterQueued(false)
        if (firstRow) openRow(firstRow)
    }, [answered, enterQueued, firstRow, openRow])

    return (
        <div className="flex min-h-0 flex-col">
            <label className="border-border flex h-10 shrink-0 items-center gap-2 border-x-0 border-b border-t-0 border-solid px-3">
                <MagnifyingGlassIcon
                    size={14}
                    aria-hidden
                    className="text-muted-foreground shrink-0"
                />
                <input
                    ref={searchRef}
                    value={typed}
                    aria-label="Search this agent's sessions"
                    placeholder="Search this agent's sessions"
                    onChange={(event) => setTyped(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && typed.trim()) setEnterQueued(true)
                    }}
                    className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 border-0 bg-transparent text-sm outline-none [font-family:inherit]"
                />
            </label>
            {/* bg-popover: the sticky group headings paint `bg-inherit` and need a surface. */}
            <div className="ag-scroll-quiet bg-popover max-h-[320px] min-h-0 overflow-y-auto p-1.5">
                <SessionCardList
                    {...listArgs}
                    search={search}
                    density="compact"
                    activeRowId={activeSessionId}
                    emptyText={search ? "No session matches." : "No sessions with this agent yet."}
                    onOpenRow={openRow}
                    menuFor={menu.menuFor}
                    onMenuSelect={menu.onMenuSelect}
                    onRenameRow={menu.onRenameRow}
                />
            </div>
            {onNew ? (
                <div className="border-border shrink-0 border-x-0 border-b-0 border-t border-solid p-1.5">
                    <button
                        type="button"
                        className={FOOTER_ROW}
                        onClick={() => {
                            onClose()
                            onNew()
                        }}
                    >
                        <PlusIcon size={14} aria-hidden className="text-muted-foreground" />
                        New session
                        <span className="ml-auto hidden md:block">
                            <ShortcutKeys id="session.new" />
                        </span>
                    </button>
                </div>
            ) : null}
        </div>
    )
}
