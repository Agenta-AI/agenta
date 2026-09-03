/**
 * Mounts quote-to-reply over an existing pane: the selection watcher, the floating pill, the inline
 * note box, and the highlight upkeep. Hosts pass a ref to the element they already render (the
 * transcript, the file preview) rather than being wrapped in another layout div — the overlays are
 * positioned absolutely inside it, so that element must be `relative`.
 *
 * With `enabled` false this binds nothing and renders nothing.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {findInSource, type Quote} from "@agenta/shared/quotes"
import {generateId} from "@agenta/shared/utils"

import {hasCoarsePointer} from "../hooks/useVisualViewport"

import {QuoteNote} from "./QuoteNote"
import {QuoteToolbar} from "./QuoteToolbar"
import {setQuoteRange} from "./sources"
import {addQuote, useSessionQuotes} from "./store"
import {useQuoteHighlights} from "./useQuoteHighlights"
import {useQuoteSelection, type QuoteCandidate} from "./useQuoteSelection"

/** Resolve the excerpt against the body's raw source so a file quote carries real line numbers. */
const draftFrom = (candidate: QuoteCandidate): Quote => {
    const source = {...candidate.source}
    if (source.kind === "file" && candidate.sourceText) {
        const hit = findInSource(candidate.sourceText, candidate.text)
        if (hit) {
            source.startLine = hit.startLine
            source.endLine = hit.endLine
        }
    }
    return {id: generateId(), text: candidate.text, note: "", staged: false, stale: false, source}
}

export const QuoteSelectionLayer = ({
    rootRef,
    sessionId,
    enabled,
    touch,
}: {
    rootRef: React.RefObject<HTMLElement | null>
    /** The conversation the quotes attach to. Null outside a session — Copy stays, Reply goes. */
    sessionId: string | null
    enabled: boolean
    touch?: boolean
}) => {
    const [draft, setDraft] = useState<{quote: Quote; candidate: QuoteCandidate} | null>(null)
    const [announced, setAnnounced] = useState("")
    const quotes = useSessionQuotes(sessionId)
    const returnFocusRef = useRef<HTMLElement | null>(null)

    const beginReply = useCallback((candidate: QuoteCandidate) => {
        returnFocusRef.current = document.activeElement as HTMLElement | null
        setDraft({quote: draftFrom(candidate), candidate})
    }, [])

    const {candidate, dismiss} = useQuoteSelection({
        rootRef,
        // Reply needs somewhere to attach; without a session there is nothing to reply into.
        enabled: enabled && !!sessionId,
        onReply: beginReply,
    })

    useQuoteHighlights(rootRef, quotes, enabled)

    // Esc closes the pill, matching the note box's own handler.
    useEffect(() => {
        if (!enabled || !candidate || draft) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") dismiss()
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [enabled, candidate, draft, dismiss])

    if (!enabled || !sessionId) return null

    const root = rootRef.current
    const bounds = {width: root?.clientWidth ?? 0, height: root?.clientHeight ?? 0}

    const closeDraft = () => {
        setDraft(null)
        returnFocusRef.current?.focus?.()
        window.getSelection()?.removeAllRanges()
    }

    const stage = (note: string) => {
        if (!draft) return
        const quote: Quote = {...draft.quote, note, staged: true}
        // The highlight anchors on the range the selection had; it survives re-render because it is
        // a Range, not a DOM node we injected.
        setQuoteRange(quote.id, draft.candidate.range)
        addQuote(sessionId, quote)
        setAnnounced(`Quote added. ${quotes.filter((q) => q.staged).length + 1} attached.`)
        closeDraft()
    }

    return (
        <>
            <div aria-live="polite" className="sr-only">
                {announced}
            </div>
            {candidate && !draft ? (
                <QuoteToolbar
                    anchor={candidate.rect}
                    bounds={bounds}
                    touch={touch ?? hasCoarsePointer()}
                    onCopy={() => {
                        void navigator.clipboard?.writeText(candidate.text)
                        dismiss()
                    }}
                    onReply={() => {
                        beginReply(candidate)
                        dismiss()
                    }}
                />
            ) : null}
            {draft ? (
                <QuoteNote
                    quote={draft.quote}
                    anchor={draft.candidate.rect}
                    bounds={bounds}
                    touch={touch ?? hasCoarsePointer()}
                    onStage={stage}
                    onCancel={closeDraft}
                />
            ) : null}
        </>
    )
}
