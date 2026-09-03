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

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeVerticalIcon} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import InlineRenameInput from "./InlineRenameInput"
import {isMenuDivider} from "./menu"
import {useInlineRename} from "./useInlineRename"
import type {SessionRowChrome} from "./useSessionRowChrome"

/** What a row needs from its session — structural, so this stays off `@agenta/navigation`. */
export interface SessionRowTarget {
    sessionId: string
    appId: string | null
    name?: string | null
    archived: boolean
}

const RENAME = "rename"

/**
 * Per-row session verbs in the nav rail — rename, pin, archive, delete.
 *
 * The verbs are the SHARED ones from `useSessionActions`, so a session behaves the same here as
 * on the sessions list. Rename is the one exception: it edits IN the row rather than opening the
 * shared modal, because a rail row is already the thing you are naming. Every other surface keeps
 * the modal — this intercepts the action here instead of changing the shared verb.
 *
 * The kebab is the only way in — no right-click menu, so a rail row keeps the browser's own.
 * It hides until hover ON A POINTER DEVICE only: `hover` never fires on touch, so
 * `pointer-coarse` keeps it visible there, which is also what makes a long press free to drag.
 */
const SessionRowActions = ({
    session,
    chrome,
    children,
}: {
    session: SessionRowTarget
    /** The verbs, resolved once for the whole rail — see `useSessionRowChrome`. */
    chrome: SessionRowChrome
    children: ReactNode
}) => {
    const {menuItems, onMenuClick, renameSession} = chrome
    const router = useRouter()
    const [open, setOpen] = useState(false)
    // Navigation is held for one double-click window so a rename doesn't also open the session.
    const navTimerRef = useRef<number | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)

    const cancelPendingNav = useCallback(() => {
        if (navTimerRef.current === null) return
        window.clearTimeout(navTimerRef.current)
        navTimerRef.current = null
    }, [])

    useEffect(() => cancelPendingNav, [cancelPendingNav])

    const target = useMemo(
        () => ({
            sessionId: session.sessionId,
            appId: session.appId,
            name: session.name ?? null,
            archived: session.archived,
        }),
        [session.sessionId, session.appId, session.name, session.archived],
    )

    const rename = useInlineRename({
        current: session.name,
        // The same target the menu verbs get, so a cached session renames its open tab too.
        onCommit: (name) => renameSession(target, name),
    })

    // `autoFocus` on the input wins the first focus; this re-claims it afterwards. Radix restores
    // focus to the menu trigger when the menu closes, and the row's own navigation lands late
    // too — both would otherwise take the caret straight back out of the input.
    useEffect(() => {
        if (!rename.renaming) return
        const claim = () => {
            inputRef.current?.focus()
            inputRef.current?.select()
        }
        claim()
        const timer = window.setTimeout(claim, 80)
        return () => window.clearTimeout(timer)
    }, [rename.renaming])

    // The row IS a link — offering "Open" in its own menu restates the click.
    const entries = useMemo(() => menuItems(target), [menuItems, target])
    const runAction = useMemo(() => onMenuClick(target), [onMenuClick, target])

    const onSelect = useCallback(
        (key: string) => {
            if (key === RENAME) {
                setOpen(false)
                rename.start()
                return
            }
            runAction({key})
        },
        [rename, runAction],
    )

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

    if (rename.renaming)
        return (
            <span className="flex w-full min-w-0 items-center" onClick={swallow}>
                <InlineRenameInput rename={rename} inputRef={inputRef} />
            </span>
        )

    return (
        <span
            className="group/row flex w-full min-w-0 items-center"
            onDoubleClick={(event) => {
                event.preventDefault()
                cancelPendingNav()
                // Archived rows cannot be renamed — the menu drops the verb, so the
                // double-click shortcut into it has to go too.
                if (!session.archived) rename.start()
            }}
        >
            {/* font-normal: the selected row's `font-medium` is a NavMenu-wide style, and
                overriding it here keeps every other rail untouched. */}
            <span className="min-w-0 flex-1 truncate font-normal">{linkWithHeldNavigation}</span>
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
                            // Themed focus ring, not the UA blue: Radix returns focus to the
                            // trigger on close, so `:focus-visible` matches and painted a stray
                            // blue box over the row. `outline-none` drops the default.
                            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextTertiary opacity-0 outline-none transition-opacity [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring group-hover/row:opacity-100 data-[open]:opacity-100 pointer-coarse:opacity-100"
                        >
                            <DotsThreeVerticalIcon size={16} weight="bold" />
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
    )
}

export default memo(SessionRowActions)
