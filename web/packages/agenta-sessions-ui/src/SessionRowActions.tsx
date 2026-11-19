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

import {useT} from "@agenta/i18n"
import sessionsRowsCatalog from "@agenta/i18n/catalogs/sessions.rows"
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
import {SessionRowContextMenu} from "./SessionRowContextMenu"
import {useInlineRename} from "./useInlineRename"
import type {SessionRowChrome} from "./useSessionRowChrome"

/** What a row needs from its session — structural, so this stays off `@agenta/navigation`. */
export interface SessionRowTarget {
    sessionId: string
    appId: string | null
    name?: string | null
    archived: boolean
    /** Sharing: the owner (null = ownerless). */
    ownerUserId?: string | null
}

const RENAME = "rename"

/**
 * A double click opens the session with its first click and renames it with the second. That
 * navigation can replace the whole rail (a move from another page to the session page remounts
 * the shell), and with it the row that was asked to rename. The request waits here for a short
 * time, so the row of that session starts the rename when it mounts.
 */
let renameOnMount: {sessionId: string; at: number} | null = null
const RENAME_ON_MOUNT_MS = 3000

// [font-family:inherit]: preflight is off, so a bare <button> renders Arial, not Inter.
// Themed focus ring, not the UA blue: Radix returns focus to the trigger on close.
const KEBAB_CLASS =
    "flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextTertiary opacity-0 outline-none transition-opacity [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring group-hover/row:opacity-100 data-[open]:opacity-100 pointer-coarse:opacity-100"

/**
 * Per-row session verbs in the nav rail — rename, pin, archive, delete.
 *
 * The verbs are the SHARED ones from `useSessionActions`, so a session behaves the same here as
 * on the sessions list. Rename is the one exception: it edits IN the row rather than opening the
 * shared modal, because a rail row is already the thing you are naming. Every other surface keeps
 * the modal — this intercepts the action here instead of changing the shared verb.
 *
 * Two ways in, one set of verbs: the kebab, which shows on hover on a pointer device and stays
 * visible on touch (`pointer-coarse`), and a right-click (long-press on touch) anywhere on the row.
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
    const t = useT(sessionsRowsCatalog)
    const {menuItems, onMenuClick, renameSession} = chrome
    const router = useRouter()
    const [open, setOpen] = useState(false)
    // Radix's menu costs a Popper and a Presence per row; mount it on first use, not on mount.
    const [armed, setArmed] = useState(false)
    const arm = useCallback(() => {
        setArmed(true)
        setOpen(true)
    }, [])
    const inputRef = useRef<HTMLInputElement | null>(null)

    // A touch long-press opens the context menu, and some browsers still click on release.
    const contextMenuPressRef = useRef(false)
    const onContextMenuOpenChange = useCallback((next: boolean) => {
        if (next) contextMenuPressRef.current = true
    }, [])

    const target = useMemo(
        () => ({
            sessionId: session.sessionId,
            appId: session.appId,
            name: session.name ?? null,
            archived: session.archived,
            ownerUserId: session.ownerUserId,
        }),
        [session.sessionId, session.appId, session.name, session.archived, session.ownerUserId],
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

    // The approved session row menu starts with "Open" on every surface (M3 UI design; QA D7):
    // it opens the row's own link.
    const rowHref = isValidElement(children)
        ? (children as ReactElement<{href?: string}>).props.href
        : undefined
    const openOptions = useMemo(
        () => (rowHref ? {onOpen: () => void router.push(rowHref)} : undefined),
        [rowHref, router],
    )
    const entries = useMemo(() => menuItems(target, openOptions), [menuItems, target, openOptions])
    const runAction = useMemo(
        () => onMenuClick(target, openOptions),
        [onMenuClick, target, openOptions],
    )

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

    // The right-click menu's select. Rename is handed back as a function so it runs once the
    // menu has closed — see `useDeferredMenuSelect`; the kebab's own close is handled above.
    const onContextSelect = useCallback(
        (key: string) => {
            if (key === RENAME) return () => rename.start()
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

    // Archived rows cannot be renamed — the menu drops the verb, so the double-click shortcut into
    // it has to go too. Nor can someone else's chat.
    const canRename = !session.archived && entries.some((e) => "key" in e && e.key === RENAME)
    const startRenameFromDoubleClick = useCallback(() => {
        if (!canRename) return
        renameOnMount = {sessionId: session.sessionId, at: Date.now()}
        rename.start()
    }, [canRename, rename, session.sessionId])

    // The row that a double click's navigation mounted takes over the rename it asked for.
    const {start: startRename} = rename
    useEffect(() => {
        const pending = renameOnMount
        if (pending?.sessionId !== session.sessionId) return
        renameOnMount = null
        if (canRename && Date.now() - pending.at < RENAME_ON_MOUNT_MS) startRename()
        // Mount only: a later change of the row's verbs is not a new double click.
    }, [session.sessionId])

    // The row was not replaced: its rename has ended, so no other row may take it over.
    useEffect(() => {
        if (!rename.renaming && renameOnMount?.sessionId === session.sessionId) renameOnMount = null
    }, [rename.renaming, session.sessionId])

    /**
     * The row's <Link>. The first click navigates at once; the second click of a double click
     * does not navigate again, and the double click then renames the session that is now open.
     *
     * next/link calls the `onClick` we pass BEFORE deciding to navigate, and skips navigating if
     * that handler prevented the default (next/dist/client/link.js: `if (e.defaultPrevented)
     * return`). The anchor keeps its href for middle-click, "open in new tab" and prefetch.
     */
    const link = useMemo(() => {
        if (!isValidElement(children)) return children
        const element = children as ReactElement<{
            onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void
        }>
        const {onClick} = element.props
        return cloneElement(element, {
            onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
                onClick?.(event)
                if (event.defaultPrevented) return
                // `detail > 0`: a pointer click. Keyboard Enter never follows a long-press.
                if (contextMenuPressRef.current && event.detail > 0) {
                    event.preventDefault()
                    return
                }
                // A modifier- or middle-click is the browser's (new tab, new window), also when
                // it is the second click of a double click.
                if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                )
                    return
                // The second click of a double click: the first one already opened the session,
                // so this one renames it. It is handled here and not on `dblclick`, because when
                // the first click's navigation replaced the row, the new row gets this click only.
                if (event.detail > 1) {
                    event.preventDefault()
                    if (event.detail === 2) startRenameFromDoubleClick()
                }
            },
        })
    }, [children, startRenameFromDoubleClick])

    if (rename.renaming)
        return (
            <span className="flex w-full min-w-0 items-center" onClick={swallow}>
                <InlineRenameInput rename={rename} inputRef={inputRef} />
            </span>
        )

    return (
        <SessionRowContextMenu
            entries={entries}
            onSelect={onContextSelect}
            onOpenChange={onContextMenuOpenChange}
        >
            <span
                className="group/row flex w-full min-w-0 items-center"
                onPointerDown={() => {
                    contextMenuPressRef.current = false
                }}
            >
                {/* font-normal overrides NavMenu's selected-row `font-medium`, this rail only. */}
                <span className="min-w-0 flex-1 truncate font-normal">{link}</span>
                <span
                    // -mr-2 pulls the kebab out past ROW_BASE's px-3 so it sits at the row's
                    // right edge. Only session rows are wrapped, so no other nav row shifts.
                    // w-6, not w-7: at 28 the 20px button sat 2px left of the group carets and the
                    // filter trigger above it, and the rail's right-hand controls read as a column.
                    className="relative z-[1] -mr-2 flex h-5 w-6 shrink-0 items-center justify-center"
                    onClick={swallow}
                >
                    {armed ? (
                        <DropdownMenu open={open} onOpenChange={setOpen}>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={t("sessions.rows.actionsFor", {
                                        name: session.name || t("sessions.rows.untitledSession"),
                                    })}
                                    data-open={open || undefined}
                                    className={KEBAB_CLASS}
                                >
                                    <DotsThreeVerticalIcon size={16} weight="bold" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="end"
                                side="bottom"
                                className="min-w-[168px]"
                            >
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
                    ) : (
                        <button
                            type="button"
                            aria-label={t("sessions.rows.actionsFor", {
                                name: session.name || t("sessions.rows.untitledSession"),
                            })}
                            aria-haspopup="menu"
                            aria-expanded={false}
                            className={KEBAB_CLASS}
                            onPointerDown={(event) => {
                                // Radix's trigger opens on pointer-down; the first press matches it.
                                if (event.button !== 0 || event.ctrlKey) return
                                arm()
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") arm()
                            }}
                        >
                            <DotsThreeVerticalIcon size={16} weight="bold" />
                        </button>
                    )}
                </span>
            </span>
        </SessionRowContextMenu>
    )
}

export default memo(SessionRowActions)
