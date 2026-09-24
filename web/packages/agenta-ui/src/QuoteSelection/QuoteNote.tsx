// Note box under a quoted span. Enter sends, ⌘/Ctrl+Enter stages, Esc or an outside press cancels.
import {useEffect, useLayoutEffect, useRef, useState} from "react"

import {truncateQuoteText, type Quote} from "@agenta/shared/quotes"
import {ArrowUp} from "@phosphor-icons/react"

import {Button} from "../components/ui/button"

const GAP = 8
const WIDTH = 320

export interface QuoteNoteProps {
    quote: Quote
    anchor: {top: number; left: number; bottom: number}
    bounds: {width: number; height: number}
    /** Add the quote to the composer, to go out with the message. */
    onStage: (note: string) => void
    /** Send the reply now. */
    onSend: (note: string) => void
    onCancel: () => void
    touch?: boolean
}

export const QuoteNote = ({
    quote,
    anchor,
    bounds,
    onStage,
    onSend,
    onCancel,
    touch,
}: QuoteNoteProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const [note, setNote] = useState("")
    const [height, setHeight] = useState(0)

    const cancelRef = useRef(onCancel)
    cancelRef.current = onCancel

    useLayoutEffect(() => {
        setHeight(ref.current?.offsetHeight ?? 0)
        inputRef.current?.focus()
    }, [])

    // Bound once: the box re-renders every scroll frame while it tracks its span.
    useEffect(() => {
        const onDown = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) cancelRef.current()
        }
        document.addEventListener("pointerdown", onDown, true)
        return () => document.removeEventListener("pointerdown", onDown, true)
    }, [])

    const width = Math.min(WIDTH, Math.max(bounds.width - GAP * 2, 200))
    const below = anchor.bottom + GAP
    const flipped = height > 0 && below + height > bounds.height && anchor.top - height - GAP > GAP
    // Clamped either way, so a flip near the top never escapes the pane.
    const top = Math.max(flipped ? anchor.top - height - GAP : below, GAP)
    const left = Math.min(
        Math.max(anchor.left - width / 2, GAP),
        Math.max(bounds.width - width - GAP, GAP),
    )

    return (
        <div
            ref={ref}
            data-quote-ignore="true"
            role="dialog"
            aria-label="Reply to the selected part"
            className="absolute z-30 flex flex-col gap-2 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated px-3 py-2.5 shadow-lg"
            style={{top, left, width, opacity: height ? 1 : 0}}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.stopPropagation()
                    onCancel()
                }
            }}
        >
            <p className="m-0 line-clamp-2 border-0 border-l-2 border-solid border-colorBorder pl-2.5 text-xs leading-5 text-colorTextSecondary">
                {truncateQuoteText(quote.text, 220)}
            </p>
            <div className="flex items-center gap-2">
                <textarea
                    ref={inputRef}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
                        e.preventDefault()
                        if (e.metaKey || e.ctrlKey) onStage(note)
                        else onSend(note)
                    }}
                    rows={1}
                    placeholder="Reply to the agent"
                    className={`max-h-24 min-h-0 flex-1 resize-none border-0 bg-transparent p-0 font-[inherit] leading-5 text-colorText outline-none [field-sizing:content] placeholder:text-colorTextPlaceholder ${
                        touch ? "text-sm" : "text-xs"
                    }`}
                />
                <Button
                    size="icon-sm"
                    className="shrink-0"
                    aria-label="Send"
                    title="Send · ⌘/Ctrl+Enter adds it to your message instead"
                    onClick={() => onSend(note)}
                >
                    <ArrowUp weight="bold" />
                </Button>
            </div>
        </div>
    )
}
