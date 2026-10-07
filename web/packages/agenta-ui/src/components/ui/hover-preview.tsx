import * as React from "react"

import {Popover, PopoverAnchor, PopoverContent} from "./popover"
import {cn} from "./utils"

const OPEN_DELAY_MS = 300
const CLOSE_DELAY_MS = 150

export interface HoverPreviewProps {
    /** One element (a link, a chip); it keeps its own click behaviour. */
    children: React.ReactElement
    /** Mounted only while open, so whatever it fetches waits for the hover. */
    content: () => React.ReactNode
    className?: string
    side?: React.ComponentProps<typeof PopoverContent>["side"]
}

/**
 * A preview card that opens after a short hover or on keyboard focus, and closes on leave or
 * Escape. Built on the kit's Popover, anchored rather than triggered, so a click on the child
 * still does what it did. Touch never opens it: a tap keeps the child's own behaviour.
 */
function HoverPreview({children, content, className, side = "top"}: HoverPreviewProps) {
    const [open, setOpen] = React.useState(false)
    const timer = React.useRef<number | undefined>(undefined)
    const schedule = React.useCallback((next: boolean) => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(
            () => setOpen(next),
            next ? OPEN_DELAY_MS : CLOSE_DELAY_MS,
        )
    }, [])
    React.useEffect(() => () => window.clearTimeout(timer.current), [])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor
                asChild
                onPointerEnter={(e: React.PointerEvent) => {
                    if (e.pointerType !== "touch") schedule(true)
                }}
                onPointerLeave={(e: React.PointerEvent) => {
                    if (e.pointerType !== "touch") schedule(false)
                }}
                onFocus={(e: React.FocusEvent<HTMLElement>) => {
                    // Keyboard focus only: a tap focuses too, and touch must not open a card.
                    if (e.currentTarget.matches(":focus-visible")) schedule(true)
                }}
                onBlur={() => schedule(false)}
            >
                {children}
            </PopoverAnchor>
            {open ? (
                <PopoverContent
                    side={side}
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    // Focus stays on the link: the card is a preview, not a dialog.
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                    onPointerEnter={() => window.clearTimeout(timer.current)}
                    onPointerLeave={() => schedule(false)}
                    className={cn(
                        "w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0 text-xs",
                        className,
                    )}
                >
                    {content()}
                </PopoverContent>
            ) : null}
        </Popover>
    )
}

export {HoverPreview}
