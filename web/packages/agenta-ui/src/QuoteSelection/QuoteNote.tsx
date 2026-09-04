/**
 * The inline note box, anchored under the highlighted span: the quote card, "What should change
 * about this part?", and a circular send. Enter stages the quote onto the composer; Esc, or a
 * click anywhere outside, cancels and drops the draft. Opens below the selection and flips above
 * when it does not fit.
 */
import {useEffect, useLayoutEffect, useRef, useState} from "react"

import type {Quote} from "@agenta/shared/quotes"
import {ArrowUp} from "@phosphor-icons/react"

import {QuoteCard} from "./QuoteCard"

const GAP = 8
const WIDTH = 320

export interface QuoteNoteProps {
    quote: Quote
    anchor: {top: number; left: number; bottom: number}
    bounds: {width: number; height: number}
    onStage: (note: string) => void
    onCancel: () => void
    touch?: boolean
}

export const QuoteNote = ({quote, anchor, bounds, onStage, onCancel, touch}: QuoteNoteProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const [note, setNote] = useState("")
    const [height, setHeight] = useState(0)

    useLayoutEffect(() => {
        setHeight(ref.current?.offsetHeight ?? 0)
        inputRef.current?.focus()
    }, [])

    // A press outside the box abandons the draft, the way any popover behaves.
    useEffect(() => {
        const onDown = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) onCancel()
        }
        // Deferred: the press that OPENED the box must not immediately close it.
        const id = setTimeout(() => document.addEventListener("pointerdown", onDown, true))
        return () => {
            clearTimeout(id)
            document.removeEventListener("pointerdown", onDown, true)
        }
    }, [onCancel])

    const width = Math.min(WIDTH, Math.max(bounds.width - GAP * 2, 200))
    const below = anchor.bottom + GAP
    const flipped = height > 0 && below + height > bounds.height && anchor.top - height - GAP > GAP
    // Clamped either way: an unclamped flip near the top escapes the pane and lands on the
    // session tabs above it.
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
            className="absolute z-30 flex flex-col gap-2 rounded-[14px] border border-solid border-colorBorderSecondary bg-colorBgElevated p-2.5 shadow-xl"
            style={{top, left, width, opacity: height ? 1 : 0}}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.stopPropagation()
                    onCancel()
                }
            }}
        >
            <QuoteCard quote={quote} onRemove={onCancel} />
            <div className="relative">
                <textarea
                    ref={inputRef}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            onStage(note)
                        }
                    }}
                    rows={touch ? 3 : 2}
                    placeholder="What should change about this part?"
                    className={`min-h-0 w-full resize-none rounded-md border border-solid border-colorBorder bg-colorBgContainer py-1.5 pl-2 font-[inherit] text-xs text-colorText outline-none placeholder:text-colorTextPlaceholder focus:border-colorPrimary ${
                        touch ? "pr-10" : "pr-9"
                    }`}
                />
                <button
                    type="button"
                    aria-label="Attach this quote"
                    onClick={() => onStage(note)}
                    className={`absolute bottom-2.5 right-2 flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-colorPrimary text-white hover:opacity-90 ${
                        touch ? "h-7 w-7" : "h-6 w-6"
                    }`}
                >
                    <ArrowUp size={touch ? 14 : 12} weight="bold" />
                </button>
            </div>
        </div>
    )
}
