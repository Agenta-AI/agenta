import {useCallback, useEffect, useRef, useState, type ReactNode} from "react"

import {Popover, PopoverAnchor, PopoverContent} from "@agenta/ui/ui"

/** Long enough that a pass across the rail opens nothing. */
const OPEN_DELAY_MS = 150
/** Covers the gap between the icon and the flyout. */
const CLOSE_DELAY_MS = 200

/**
 * A collapsed-rail icon whose flyout opens on hover. The icon keeps its own click (it navigates);
 * the flyout stays open while the pointer is over it, or while focus is inside it.
 */
export const HoverFlyout = ({
    content,
    children,
}: {
    content: (close: () => void) => ReactNode
    children: ReactNode
}) => {
    const [open, setOpen] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const contentRef = useRef<HTMLDivElement>(null)

    const clear = () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
    }
    const close = useCallback(() => {
        clear()
        setOpen(false)
    }, [])
    const show = () => {
        clear()
        timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS)
    }
    const hide = () => {
        clear()
        timer.current = setTimeout(() => {
            // Typing in the flyout's search must not lose the panel when the pointer drifts off.
            if (contentRef.current?.contains(document.activeElement)) return
            setOpen(false)
        }, CLOSE_DELAY_MS)
    }

    useEffect(() => clear, [])

    return (
        <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
            <PopoverAnchor asChild>
                <div onPointerEnter={show} onPointerLeave={hide} onClick={close}>
                    {children}
                </div>
            </PopoverAnchor>
            <PopoverContent
                ref={contentRef}
                side="right"
                align="start"
                sideOffset={8}
                className="flex w-[280px] flex-col gap-0 p-0"
                // Hover must not steal the caret from wherever it is.
                onOpenAutoFocus={(event) => event.preventDefault()}
                onPointerEnter={clear}
                onPointerLeave={hide}
            >
                {content(close)}
            </PopoverContent>
        </Popover>
    )
}
