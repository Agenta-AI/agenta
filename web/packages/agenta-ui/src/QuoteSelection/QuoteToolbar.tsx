// The Copy · Reply pill over a selection: above it, flipped below when there is no room.
import {useLayoutEffect, useRef, useState} from "react"

const GAP = 8

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
            className="absolute z-30 flex items-center gap-px rounded-lg border border-solid border-colorBorderSecondary bg-colorBgElevated p-0.5 shadow-lg"
            style={{top, left, opacity: size.height ? 1 : 0}}
            // A mousedown inside the pill would collapse the very selection it acts on.
            onMouseDown={(e) => e.preventDefault()}
        >
            <button
                type="button"
                onClick={onCopy}
                className={`flex cursor-pointer items-center rounded-md border-0 bg-transparent px-2 font-medium text-colorText hover:bg-colorFillTertiary ${
                    touch ? "h-6 text-[11px]" : "h-5 text-[11px]"
                }`}
            >
                Copy
            </button>
            <span className="h-3 w-px bg-colorBorderSecondary" aria-hidden />
            <button
                type="button"
                onClick={onReply}
                className={`flex cursor-pointer items-center rounded-md border-0 bg-transparent px-2 font-medium text-colorText hover:bg-colorFillTertiary ${
                    touch ? "h-6 text-[11px]" : "h-5 text-[11px]"
                }`}
            >
                Reply
            </button>
        </div>
    )
}
