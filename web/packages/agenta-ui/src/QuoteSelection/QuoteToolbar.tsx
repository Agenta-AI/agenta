// The Copy · Reply pill over a selection: above it, flipped below when there is no room.
import {useLayoutEffect, useRef, useState} from "react"

import {Copy, Quotes} from "@phosphor-icons/react"

const GAP = 8

const actionClass = (touch?: boolean) =>
    `flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium text-popover-foreground hover:bg-accent [&_svg]:shrink-0 [&_svg]:text-muted-foreground ${
        touch ? "h-6" : "h-5"
    }`

export interface QuoteToolbarProps {
    /** Root-relative anchor: `left` is the selection's centre. */
    anchor: {top: number; left: number; bottom: number}
    /** The pane the pill must stay inside. */
    bounds: {width: number; height: number}
    onCopy: () => void
    onReply: () => void
    /** Larger hit targets on a touch screen, per the shared `touch` convention. */
    touch?: boolean
}

export const QuoteToolbar = ({anchor, bounds, onCopy, onReply, touch}: QuoteToolbarProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({width: 0, height: 0})

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        setSize({width: el.offsetWidth, height: el.offsetHeight})
    }, [touch])

    const above = anchor.top - size.height - GAP
    // Flip below unless there is room above inside the pane.
    const flipped = above < GAP
    const top = flipped ? anchor.bottom + GAP : above
    const left = Math.min(
        Math.max(anchor.left - size.width / 2, GAP),
        Math.max(bounds.width - size.width - GAP, GAP),
    )

    return (
        <div
            ref={ref}
            data-quote-ignore="true"
            role="toolbar"
            aria-label="Quote actions"
            className="absolute z-30 flex items-center rounded-lg border border-solid border-border/60 bg-popover p-0.5 shadow-md"
            style={{top, left, opacity: size.height ? 1 : 0}}
            // A mousedown inside the pill would collapse the very selection it acts on.
            onMouseDown={(e) => e.preventDefault()}
        >
            <button type="button" onClick={onCopy} className={actionClass(touch)}>
                <Copy size={12} />
                Copy
            </button>
            <span className="mx-1 h-3 w-px bg-border/60" aria-hidden />
            <button type="button" onClick={onReply} className={actionClass(touch)}>
                <Quotes size={12} weight="fill" />
                Reply
            </button>
        </div>
    )
}
