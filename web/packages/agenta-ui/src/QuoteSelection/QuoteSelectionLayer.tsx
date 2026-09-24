/**
 * Mounts quote-to-reply over an existing pane: the selection watcher, the floating pill, the inline
 * note box, and the highlight upkeep. Hosts pass a ref to the element they already render (the
 * transcript, the file preview) rather than being wrapped in another layout div — the overlays are
 * positioned absolutely inside it, so that element must be `relative`.
 *
 * Outside a conversation (no session to reply into) this binds nothing and renders nothing.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {findInSource, type Quote} from "@agenta/shared/quotes"
import {generateId} from "@agenta/shared/utils"

import {hasCoarsePointer} from "../hooks/useVisualViewport"

import {QuoteNote} from "./QuoteNote"
import {QuoteToolbar} from "./QuoteToolbar"
import {dropQuoteRange, setQuoteRange} from "./sources"
import {addQuote, submitSessionMessage, useSessionQuotes} from "./store"
import {useQuoteHighlights} from "./useQuoteHighlights"
import {rectIn, useQuoteSelection, type QuoteCandidate} from "./useQuoteSelection"

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
    touch,
}: {
    rootRef: React.RefObject<HTMLElement | null>
    /** The conversation the quotes attach to. Null outside a session — Copy stays, Reply goes. */
    sessionId: string | null
    touch?: boolean
}) => {
    const [draft, setDraft] = useState<{quote: Quote; candidate: QuoteCandidate} | null>(null)
    const [announced, setAnnounced] = useState("")
    const quotes = useSessionQuotes(sessionId)
    const returnFocusRef = useRef<HTMLElement | null>(null)
    // Read by the scroll tracker, so it can bind once per note instead of once per scroll frame.
    const draftRangeRef = useRef<Range | null>(null)
    draftRangeRef.current = draft?.candidate.range ?? null
    const draftId = draft?.quote.id

    const beginReply = useCallback((candidate: QuoteCandidate) => {
        returnFocusRef.current = document.activeElement as HTMLElement | null
        const quote = draftFrom(candidate)
        // Highlight the span the moment Reply is pressed — the native selection is gone by then,
        // and the note box has to point at something.
        setQuoteRange(quote.id, candidate.range)
        setDraft({quote, candidate})
    }, [])

    const {candidate, dismiss} = useQuoteSelection({
        rootRef,
        // Reply needs somewhere to attach; without a session there is nothing to reply into.
        enabled: !!sessionId,
        onReply: beginReply,
    })

    // Only the open draft is painted — the native selection is gone once the note takes focus, so
    // this is what keeps the span visible while you write. A staged quote lives on as its chip.
    const painted = useMemo(() => (draft ? [draft.quote] : []), [draft])
    useQuoteHighlights(rootRef, painted, !!sessionId)

    // The open note rides with its span: its box is positioned against the root, so leaving the
    // anchor frozen would strand it over whatever scrolled under it.
    useEffect(() => {
        if (!draftId) return
        const track = () => {
            const root = rootRef.current
            const range = draftRangeRef.current
            if (!root || !range) return
            const rect = rectIn(root, range)
            if (!rect) return
            setDraft((held) =>
                held && held.quote.id === draftId
                    ? {...held, candidate: {...held.candidate, rect}}
                    : held,
            )
        }
        window.addEventListener("resize", track)
        // Capture: the scroller sits under the root and scroll does not bubble.
        document.addEventListener("scroll", track, true)
        return () => {
            window.removeEventListener("resize", track)
            document.removeEventListener("scroll", track, true)
        }
    }, [draftId, rootRef])

    // Esc closes the pill, matching the note box's own handler.
    useEffect(() => {
        if (!candidate || draft) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") dismiss()
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [candidate, draft, dismiss])

    if (!sessionId) return null

    const root = rootRef.current
    const bounds = {width: root?.clientWidth ?? 0, height: root?.clientHeight ?? 0}

    const closeDraft = () => {
        // A cancelled draft leaves no highlight behind.
        if (draft) dropQuoteRange(draft.quote.id)
        setDraft(null)
        returnFocusRef.current?.focus?.()
        window.getSelection()?.removeAllRanges()
    }

    const stage = (note: string) => {
        if (!draft) return
        const quote: Quote = {...draft.quote, note, staged: true}
        addQuote(sessionId, quote)
        setAnnounced(`Quote added. ${quotes.filter((q) => q.staged).length + 1} attached.`)
        // Staged, the quote is its chip; the span it came from is no longer marked.
        dropQuoteRange(draft.quote.id)
        setDraft(null)
        returnFocusRef.current?.focus?.()
        window.getSelection()?.removeAllRanges()
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
                        // The selection as it reads, line breaks and all — not the normalised excerpt.
                        void navigator.clipboard?.writeText(candidate.range.toString())
                        dismiss()
                        window.getSelection()?.removeAllRanges()
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
                    // Staged first, so the composer's send picks it up with everything else held.
                    onSend={(note) => {
                        stage(note)
                        submitSessionMessage(sessionId)
                    }}
                    onCancel={closeDraft}
                />
            ) : null}
        </>
    )
}
