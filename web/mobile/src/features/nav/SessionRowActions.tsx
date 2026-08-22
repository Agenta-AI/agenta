import {
    cloneElement,
    isValidElement,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type ReactElement,
    type ReactNode,
} from "react"

import {setSessionHeader} from "@agenta/entities/session"
import type {SessionSidebarRef} from "@agenta/navigation"
import {isMenuDivider, SessionRowContextMenu, useSessionActions} from "@agenta/sessions-ui"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {MoreVertical} from "lucide-react"
import {useRouter} from "next/router"

const RENAME = "rename"

/**
 * Per-row session verbs in the nav rail — rename, pin, archive, delete.
 *
 * The verbs are the SHARED ones from `useSessionActions`, so a session behaves the same here as
 * on the sessions list. Rename is the one exception: it edits IN the row rather than opening the
 * shared modal, because a rail row is already the thing you are naming. Every other surface keeps
 * the modal — this intercepts the action here instead of changing the shared verb.
 *
 * Two ways into the menu: long-press (Radix ContextMenu opens on a 700ms touch hold) and a kebab.
 * The kebab hides until hover ON A POINTER DEVICE only — `hover` never fires on touch, so
 * `pointer-coarse` keeps it visible there.
 */
const SessionRowActions = ({
    session,
    children,
}: {
    session: SessionSidebarRef
    children: ReactNode
}) => {
    const {menuItems, onMenuClick} = useSessionActions()
    const router = useRouter()
    const queryClient = useQueryClient()
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const [open, setOpen] = useState(false)
    const [renaming, setRenaming] = useState(false)
    const [draft, setDraft] = useState("")
    // Enter commits and blurs; without this the blur would commit a second time.
    const committedRef = useRef(false)
    // Navigation is held for one double-click window so a rename doesn't also open the session.
    const navTimerRef = useRef<number | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)

    const cancelPendingNav = useCallback(() => {
        if (navTimerRef.current === null) return
        window.clearTimeout(navTimerRef.current)
        navTimerRef.current = null
    }, [])

    useEffect(() => cancelPendingNav, [cancelPendingNav])

    // `autoFocus` on the input wins the first focus; this re-claims it afterwards. Radix restores
    // focus to the menu trigger when the menu closes, and the row's own navigation lands late
    // too — both would otherwise take the caret straight back out of the input.
    useEffect(() => {
        if (!renaming) return
        const claim = () => {
            inputRef.current?.focus()
            inputRef.current?.select()
        }
        claim()
        const timer = window.setTimeout(claim, 80)
        return () => window.clearTimeout(timer)
    }, [renaming])

    const target = useMemo(
        () => ({
            sessionId: session.sessionId,
            appId: session.appId,
            name: session.name ?? null,
            archived: session.archived,
        }),
        [session.sessionId, session.appId, session.name, session.archived],
    )

    // The row IS a link — offering "Open" in its own menu restates the click.
    const entries = useMemo(() => menuItems(target), [menuItems, target])
    const runAction = useMemo(() => onMenuClick(target), [onMenuClick, target])

    const startRename = useCallback(() => {
        committedRef.current = false
        setDraft(session.name ?? "")
        setRenaming(true)
    }, [session.name])

    const onSelect = useCallback(
        (key: string) => {
            if (key === RENAME) {
                setOpen(false)
                startRename()
                return
            }
            runAction({key})
        },
        [runAction, startRename],
    )

    const commit = useCallback(async () => {
        if (committedRef.current) return
        committedRef.current = true
        const name = draft.trim()
        setRenaming(false)
        if (!name || name === (session.name ?? "")) return

        const ok = await setSessionHeader({sessionId: session.sessionId, projectId, name})
        if (!ok) {
            message.error("Couldn't rename this session")
            return
        }
        // The same key set the shared verbs invalidate, plus the rail's own two.
        for (const key of [
            ["sidebar-sessions"],
            ["sidebar-sessions-pinned"],
            ["session-list"],
            ["sessions-page"],
        ]) {
            void queryClient.invalidateQueries({queryKey: key})
        }
    }, [draft, projectId, queryClient, session.name, session.sessionId])

    // The row's link stretches a ::before over the whole item — swallow presses on the controls
    // so they don't also navigate into the session.
    const swallow = useCallback((event: React.MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
    }, [])

    /**
     * The row's <Link>, with its navigation put on a short leash.
     *
     * next/link calls the `onClick` we pass BEFORE deciding to navigate, and skips navigating if
     * that handler prevented the default (next/dist/client/link.js: `if (e.defaultPrevented)
     * return`). So a click can be held for one double-click window and replayed by us — no
     * stopPropagation, and the anchor keeps its href for middle-click, "open in new tab" and
     * prefetch.
     */
    const linkWithHeldNavigation = useMemo(() => {
        if (!isValidElement(children)) return children
        const link = children as ReactElement<{
            href?: string
            onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void
        }>
        const {href, onClick} = link.props
        return cloneElement(link, {
            onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
                onClick?.(event)
                if (event.defaultPrevented) return
                // Let the browser own modifier- and middle-clicks (new tab, new window).
                if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                )
                    return
                event.preventDefault()
                // Second click of a double-click: the first one's timer is still pending.
                if (navTimerRef.current !== null || !href) return
                navTimerRef.current = window.setTimeout(() => {
                    navTimerRef.current = null
                    void router.push(href)
                }, 220)
            },
        })
    }, [children, router])

    if (renaming)
        return (
            <span className="flex w-full min-w-0 items-center" onClick={swallow}>
                <input
                    ref={inputRef}
                    autoFocus
                    value={draft}
                    aria-label="Session name"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void commit()}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") void commit()
                        if (event.key === "Escape") {
                            committedRef.current = true
                            setRenaming(false)
                        }
                    }}
                    className="h-5 w-full min-w-0 rounded border border-solid border-colorBorder bg-colorBgContainer px-1 text-[13px] leading-5 text-colorText outline-none [font-family:inherit] focus:border-colorPrimary"
                />
            </span>
        )

    return (
        <SessionRowContextMenu entries={entries} onSelect={onSelect}>
            <span
                className="group/row flex w-full min-w-0 items-center"
                onDoubleClick={(event) => {
                    event.preventDefault()
                    cancelPendingNav()
                    // Archived rows cannot be renamed — the menu drops the verb, so the
                    // double-click shortcut into it has to go too.
                    if (!session.archived) startRename()
                }}
            >
                {/* font-normal: the selected row's `font-medium` is a NavMenu-wide style, and
                    overriding it here keeps every other rail untouched. */}
                <span className="min-w-0 flex-1 truncate font-normal">
                    {linkWithHeldNavigation}
                </span>
                <span
                    // -mr-2 pulls the kebab out past ROW_BASE's px-3 so it sits at the row's
                    // right edge. Only session rows are wrapped, so no other nav row shifts.
                    className="relative z-[1] -mr-2 flex h-5 w-7 shrink-0 items-center justify-center"
                    onClick={swallow}
                >
                    <DropdownMenu open={open} onOpenChange={setOpen}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label={`Actions for ${session.name || "Untitled session"}`}
                                data-open={open || undefined}
                                // [font-family:inherit]: preflight is off, so a bare <button>
                                // renders Arial while the rows around it render Inter.
                                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextTertiary opacity-0 transition-opacity [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText focus-visible:opacity-100 group-hover/row:opacity-100 data-[open]:opacity-100 pointer-coarse:opacity-100"
                            >
                                <MoreVertical size={14} />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="bottom" className="min-w-[168px]">
                            {entries.map((entry, index) =>
                                isMenuDivider(entry) ? (
                                    <DropdownMenuSeparator key={`divider-${index}`} />
                                ) : (
                                    <DropdownMenuItem
                                        key={entry.key}
                                        disabled={entry.disabled}
                                        variant={entry.danger ? "destructive" : undefined}
                                        onSelect={() => onSelect(entry.key)}
                                    >
                                        {entry.icon ? (
                                            <span className="flex shrink-0 items-center">
                                                {entry.icon}
                                            </span>
                                        ) : null}
                                        {entry.label}
                                    </DropdownMenuItem>
                                ),
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </span>
            </span>
        </SessionRowContextMenu>
    )
}

export default memo(SessionRowActions)
