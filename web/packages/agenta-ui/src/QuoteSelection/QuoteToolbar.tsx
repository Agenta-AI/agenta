/**
 * The floating pill that appears at the centre of a selection: Copy · Reply. Anchored above the
 * selection, flipped below when there is no room, and clamped inside the pane so a selection at
 * either edge still reaches its own controls.
 */
import {useLayoutEffect, useRef, useState} from "react"

import {ChatCircleText, Copy} from "@phosphor-icons/react"

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
    // Flip below unless the slot above clears the pane's top edge — a negative top escapes the
    // pane and draws over the session tabs above it.
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
            className="absolute z-30 flex items-center gap-0.5 rounded-[9px] border border-solid border-colorBorderSecondary bg-colorBgElevated p-1 shadow-lg"
            style={{top, left, opacity: size.height ? 1 : 0}}
            // A mousedown inside the pill would collapse the very selection it acts on.
            onMouseDown={(e) => e.preventDefault()}
        >
            <button
                type="button"
                onClick={onCopy}
                className={`flex cursor-pointer items-center gap-1.5 rounded-[7px] border-0 bg-transparent px-2.5 font-medium text-colorText hover:bg-colorFillTertiary ${
                    touch ? "h-9 text-sm" : "h-7 text-xs"
                }`}
            >
                <Copy size={touch ? 16 : 14} />
                Copy
            </button>
            <span className="h-4 w-px bg-colorBorderSecondary" aria-hidden />
            <button
                type="button"
                onClick={onReply}
                autoFocus
                className={`flex cursor-pointer items-center gap-1.5 rounded-[7px] border-0 bg-transparent px-2.5 font-medium text-colorPrimary hover:bg-colorFillTertiary ${
                    touch ? "h-9 text-sm" : "h-7 text-xs"
                }`}
            >
                <ChatCircleText size={touch ? 16 : 14} />
                Reply
            </button>
        </div>
    )
}
