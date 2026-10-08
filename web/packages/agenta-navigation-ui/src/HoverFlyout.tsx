import {useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode} from "react"

import {Popover, PopoverAnchor, PopoverContent} from "@agenta/ui/ui"

/** Long enough that a pass across the rail opens nothing. */
const OPEN_DELAY_MS = 150
/** Covers the gap between the icon and the flyout. */
const CLOSE_DELAY_MS = 200

/**
 * A collapsed-rail icon whose flyout opens on hover, or on ArrowRight from the focused icon. The
 * icon keeps its own click (it navigates); the flyout stays open while the pointer is over it,
 * while focus is inside it, or while its content holds it open.
 */
export const HoverFlyout = ({
    content,
    children,
}: {
    /** `close` always closes; `hold(true)` blocks hover-out and outside-click dismissal. */
    content: (close: () => void, hold: (held: boolean) => void) => ReactNode
    children: ReactNode
}) => {
    const [open, setOpen] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const anchorRef = useRef<HTMLDivElement>(null)
    const held = useRef(false)
    const byKeyboard = useRef(false)

    const clear = () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
    }
    const close = useCallback(() => {
        clear()
        setOpen(false)
    }, [])
    const hold = useCallback((next: boolean) => {
        held.current = next
    }, [])
    const show = () => {
        clear()
        timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS)
    }
    const hide = () => {
        clear()
        timer.current = setTimeout(() => {
            // Typing in the flyout's search must not lose the panel when the pointer drifts off.
            if (held.current || contentRef.current?.contains(document.activeElement)) return
            setOpen(false)
        }, CLOSE_DELAY_MS)
    }
    // The keyboard path the hover path has no equivalent for: ArrowRight opens and focuses it.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowRight") return
        event.preventDefault()
        clear()
        byKeyboard.current = true
        setOpen(true)
    }

    useEffect(() => clear, [])

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) setOpen(true)
                else if (!held.current) close()
            }}
        >
            <PopoverAnchor asChild>
                <div
                    ref={anchorRef}
                    onPointerEnter={show}
                    onPointerLeave={hide}
                    onClick={close}
                    onKeyDown={onKeyDown}
                >
                    {children}
                </div>
            </PopoverAnchor>
            <PopoverContent
                ref={contentRef}
                side="right"
                align="start"
                sideOffset={8}
                className="flex w-[280px] flex-col gap-0 p-0"
                // Hover must not steal the caret; a keyboard open moves it into the flyout.
                onOpenAutoFocus={(event) => {
                    if (!byKeyboard.current) event.preventDefault()
                }}
                // No trigger to return to: a keyboard user goes back to the icon, a pointer user stays put.
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (byKeyboard.current)
                        anchorRef.current?.querySelector<HTMLElement>("a")?.focus()
                    byKeyboard.current = false
                }}
                onPointerEnter={clear}
                onPointerLeave={hide}
            >
                {content(close, hold)}
            </PopoverContent>
        </Popover>
    )
}
