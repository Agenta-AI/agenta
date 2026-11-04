import {useRef, useState, type KeyboardEvent} from "react"

import type {SessionRowVm} from "@agenta/sessions/row"
import {SessionCardList} from "@agenta/sessions-ui"
import {useDebounceInput} from "@agenta/shared/hooks"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {ArrowRightIcon, MagnifyingGlassIcon, PlusIcon} from "@phosphor-icons/react"
import Link from "next/link"
import {useRouter} from "next/router"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

const FOOTER_ROW =
    "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3 text-left text-sm text-foreground no-underline [font-family:inherit] hover:bg-accent"

/** This agent's sessions: search, the list, and the two ways out of it. */
export const SessionSwitcherPanel = ({
    agentId,
    base,
    activeSessionId,
    onNew,
    onClose,
}: {
    agentId?: string | null
    /** `/w/:workspace/p/:project` */
    base: string
    activeSessionId: string
    /** Omit where there is no agent to start a session with. */
    onNew?: () => void
    onClose: () => void
}) => {
    const router = useRouter()
    const menu = useSessionRowMenu(base)
    const listRef = useRef<HTMLDivElement>(null)
    const [search, setSearch] = useState("")
    const [typed, setTyped] = useDebounceInput<string>(search, setSearch, 250, "")

    const openRow = (vm: SessionRowVm) => {
        onClose()
        if (vm.id !== activeSessionId) void router.push(`${base}/sessions/${vm.id}`)
    }

    const openFirstResult = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") return
        // Each row's first button is its title, which is the open action.
        listRef.current?.querySelector("button")?.click()
    }

    return (
        <div className="flex min-h-0 flex-col">
            <label className="border-border flex h-10 shrink-0 items-center gap-2 border-x-0 border-b border-t-0 border-solid px-3">
                <MagnifyingGlassIcon
                    size={14}
                    aria-hidden
                    className="text-muted-foreground shrink-0"
                />
                <input
                    autoFocus
                    value={typed}
                    aria-label="Search this agent's sessions"
                    placeholder="Search this agent's sessions"
                    onChange={(event) => setTyped(event.target.value)}
                    onKeyDown={openFirstResult}
                    className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 border-0 bg-transparent text-sm outline-none [font-family:inherit]"
                />
            </label>
            {/* bg-popover: the sticky group headings paint `bg-inherit` and need a surface. */}
            <div
                ref={listRef}
                className="ag-scroll-quiet bg-popover max-h-[320px] min-h-0 overflow-y-auto p-1.5"
            >
                <SessionCardList
                    agentId={agentId ?? undefined}
                    policy={{origin: "exclude-trigger", expansions: []}}
                    limit={30}
                    withPinned
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
            <div className="border-border shrink-0 border-x-0 border-b-0 border-t border-solid p-1.5">
                {onNew ? (
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
                        <span className="ml-auto">
                            <ShortcutKeys id="session.new" />
                        </span>
                    </button>
                ) : null}
                <Link
                    href={`${base}/sessions${agentId ? `?agent=${agentId}` : ""}`}
                    onClick={onClose}
                    className={FOOTER_ROW}
                >
                    All sessions
                    <ArrowRightIcon
                        size={14}
                        aria-hidden
                        className="text-muted-foreground ml-auto"
                    />
                </Link>
            </div>
        </div>
    )
}
