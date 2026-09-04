/**
 * The inline note box, anchored under the highlighted span: the quote card, "What should change
 * about this part?", and a circular send. Enter stages the quote onto the composer; Esc cancels
 * and drops the draft. Opens below the selection and flips above when it does not fit.
 */
import {useLayoutEffect, useRef, useState} from "react"

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

    const width = Math.min(WIDTH, Math.max(bounds.width - GAP * 2, 200))
    const below = anchor.bottom + GAP
    const flipped = height > 0 && below + height > bounds.height && anchor.top - height - GAP > 0
    const top = flipped ? anchor.top - height - GAP : below
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
            <div className="flex items-end gap-2">
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
                    className="min-h-0 flex-1 resize-none rounded-md border border-solid border-colorBorder bg-colorBgContainer px-2 py-1.5 text-xs text-colorText outline-none placeholder:text-colorTextPlaceholder focus:border-colorPrimary"
                />
                <button
                    type="button"
                    aria-label="Attach this quote"
                    onClick={() => onStage(note)}
                    className={`flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-colorPrimary text-white hover:opacity-90 ${
                        touch ? "h-9 w-9" : "h-7 w-7"
                    }`}
                >
                    <ArrowUp size={touch ? 16 : 14} weight="bold" />
                </button>
            </div>
        </div>
    )
}
