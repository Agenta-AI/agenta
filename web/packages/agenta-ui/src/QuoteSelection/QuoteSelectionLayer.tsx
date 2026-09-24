// Quote-to-reply over a `relative` pane: selection pill, note box, draft highlight.
import {useCallback, useEffect, useRef, useState} from "react"

import {findInSource, type Quote} from "@agenta/shared/quotes"
import {generateId} from "@agenta/shared/utils"

import {hasCoarsePointer} from "../hooks/useVisualViewport"

import {QuoteNote} from "./QuoteNote"
import {QuoteToolbar} from "./QuoteToolbar"
import {addQuote, submitSessionMessage, useStagedQuotes} from "./store"
import {useDraftHighlight} from "./useQuoteHighlights"
import {rectIn, useQuoteSelection, type QuoteCandidate} from "./useQuoteSelection"

const draftFrom = (candidate: QuoteCandidate): Quote => {
    const source = {...candidate.source}
    // A file quote carries the line range its excerpt sits on.
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
    /** Null outside a conversation: nothing to reply into, so the layer stays inert. */
    sessionId: string | null
    touch?: boolean
}) => {
    const [draft, setDraft] = useState<{quote: Quote; candidate: QuoteCandidate} | null>(null)
    const [announced, setAnnounced] = useState("")
    const staged = useStagedQuotes(sessionId)
    const returnFocusRef = useRef<HTMLElement | null>(null)
    const draftRange = draft?.candidate.range ?? null
    const draftId = draft?.quote.id

    const beginReply = useCallback((candidate: QuoteCandidate) => {
        returnFocusRef.current = document.activeElement as HTMLElement | null
        setDraft({quote: draftFrom(candidate), candidate})
    }, [])

    const {candidate, dismiss} = useQuoteSelection({
        rootRef,
        enabled: !!sessionId,
        onReply: beginReply,
    })

    // The native selection is gone once the note takes focus; this keeps the span visible.
    useDraftHighlight(draftRange)

    // The note rides with its span as the pane scrolls.
    useEffect(() => {
        if (!draftId || !draftRange) return
        const track = () => {
            const root = rootRef.current
            const rect = root ? rectIn(root, draftRange) : null
            if (!rect) return
            setDraft((held) =>
                held?.quote.id === draftId ? {...held, candidate: {...held.candidate, rect}} : held,
            )
        }
        window.addEventListener("resize", track)
        document.addEventListener("scroll", track, true)
        return () => {
            window.removeEventListener("resize", track)
            document.removeEventListener("scroll", track, true)
        }
    }, [draftId, draftRange, rootRef])

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
    const isTouch = touch ?? hasCoarsePointer()

    const finish = () => {
        setDraft(null)
        returnFocusRef.current?.focus?.()
        window.getSelection()?.removeAllRanges()
    }

    const stage = (note: string) => {
        if (!draft) return
        addQuote(sessionId, {...draft.quote, note, staged: true})
        setAnnounced(`Quote added. ${staged.length + 1} attached.`)
        finish()
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
                    touch={isTouch}
                    onCopy={() => {
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
                    key={draft.quote.id}
                    quote={draft.quote}
                    anchor={draft.candidate.rect}
                    bounds={bounds}
                    touch={isTouch}
                    onStage={stage}
                    // Staged first, so the composer's send carries it with everything else held.
                    onSend={(note) => {
                        stage(note)
                        submitSessionMessage(sessionId)
                    }}
                    onCancel={finish}
                />
            ) : null}
        </>
    )
}
