// Note box under a quoted span. Enter stages, ⌘/Ctrl+Enter sends, Esc or an outside press cancels.
import {useEffect, useLayoutEffect, useRef, useState} from "react"

import {truncateQuoteText, type Quote} from "@agenta/shared/quotes"
import {ArrowUp, Quotes} from "@phosphor-icons/react"

import {Button} from "../components/ui/button"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../components/ui/tooltip"
import {ShortcutKeys} from "../shortcuts/ShortcutKeys"

const GAP = 8
const WIDTH = 320
// Long enough that moving through to the button does not flash it.
const TOOLTIP_DELAY_MS = 700

export interface QuoteNoteProps {
    quote: Quote
    anchor: {top: number; left: number; bottom: number}
    bounds: {width: number; height: number}
    /** Add the quote to the composer, to go out with the message. */
    onStage: (note: string) => void
    /** Send the reply now. */
    onSend: (note: string) => void
    onCancel: () => void
}

export const QuoteNote = ({quote, anchor, bounds, onStage, onSend, onCancel}: QuoteNoteProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const [note, setNote] = useState("")
    const [height, setHeight] = useState(0)

    const cancelRef = useRef(onCancel)
    cancelRef.current = onCancel

    useLayoutEffect(() => {
        const box = ref.current
        setHeight(box?.offsetHeight ?? 0)
        inputRef.current?.focus({preventScroll: true})
        // The note grows with its text, so the flip and clamp must follow the new height.
        if (!box || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(() => setHeight(box.offsetHeight))
        observer.observe(box)
        return () => observer.disconnect()
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
            className="absolute z-30 flex flex-col overflow-hidden rounded-lg bg-popover shadow-lg"
            style={{top, left, width, opacity: height ? 1 : 0}}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault()
                    e.stopPropagation()
                    onCancel()
                }
            }}
        >
            {/* A foreground tint: dark mode's muted and popover are the same color. */}
            <div className="flex gap-2.5 bg-foreground/5 px-3.5 py-3">
                <Quotes
                    size={14}
                    weight="fill"
                    className="mt-[3px] shrink-0 text-muted-foreground"
                />
                <p className="m-0 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                    {truncateQuoteText(quote.text, 220)}
                </p>
            </div>
            <div className="flex flex-col gap-1 px-3.5 pb-2.5 pt-3">
                <textarea
                    ref={inputRef}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
                        e.preventDefault()
                        if (e.metaKey || e.ctrlKey) onSend(note)
                        else onStage(note)
                    }}
                    rows={2}
                    placeholder="Ask about this…"
                    className="max-h-32 min-h-10 resize-none border-0 bg-transparent p-0 font-[inherit] text-[13px] leading-5 text-popover-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
                />
                <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="icon-sm"
                                className="self-end"
                                aria-label="Add to message"
                                aria-keyshortcuts="Enter"
                                onClick={() => onStage(note)}
                            >
                                <ArrowUp weight="bold" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <span className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                                Add to message
                                <ShortcutKeys chord={{key: "↵"}} tone="inverse" aria-hidden />
                                Send now
                                <ShortcutKeys
                                    chord={{modifiers: ["mod"], key: "↵"}}
                                    tone="inverse"
                                    aria-hidden
                                />
                            </span>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
        </div>
    )
}
