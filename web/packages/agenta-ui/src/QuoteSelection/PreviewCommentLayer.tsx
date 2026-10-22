// Comments on a rendered preview: note box at a pick, numbered pins, pin card with Edit and Delete.
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject} from "react"

import {
    isPreviewQuote,
    truncateQuoteText,
    type PreviewAnchor,
    type PreviewQuote,
    type Quote,
} from "@agenta/shared/quotes"
import {generateId} from "@agenta/shared/utils"

import {Button} from "../components/ui/button"
import {HoverCard, HoverCardContent, HoverCardTrigger} from "../components/ui/hover-card"
import {Popover, PopoverContent, PopoverTrigger} from "../components/ui/popover"
import {hasCoarsePointer} from "../hooks/useVisualViewport"

import {QuoteNote} from "./QuoteNote"
import {
    addQuote,
    getQuotes,
    removeQuote,
    submitSessionMessage,
    updateQuote,
    useSessionQuotes,
} from "./store"

/** The document on screen; a comment and its pin belong to it. */
export interface PreviewCommentTarget {
    path: string
    displayPath: string
    fileName: string
    mountId?: string
}

/** In the layer root's coordinates. */
export interface PreviewRect {
    top: number
    left: number
    width: number
    height: number
}

export interface PreviewPick {
    anchor: PreviewAnchor
    text: string
    rect: PreviewRect
}

/** Where a staged comment's element is now; null when it is gone. */
export interface PreviewPinRect {
    id: string
    rect: PreviewRect | null
}

export interface PreviewCommentLayerProps {
    rootRef: RefObject<HTMLElement | null>
    /** Null outside a conversation: the layer stays inert. */
    sessionId: string | null
    target: PreviewCommentTarget
    pick: PreviewPick | null
    onPickConsumed: () => void
    /** The draft note closed (staged, sent or cancelled). */
    onDraftClose?: () => void
    pinRects: PreviewPinRect[]
    touch?: boolean
}

type Editor = {kind: "draft"; quote: Quote; rect: PreviewRect} | {kind: "edit"; id: string}

/** Staged preview comments on this target, in store order. */
export const usePreviewComments = (
    sessionId: string | null,
    target: PreviewCommentTarget,
): PreviewQuote[] => {
    const quotes = useSessionQuotes(sessionId)
    const {path, mountId} = target
    return useMemo(
        () =>
            quotes.filter(
                (quote): quote is PreviewQuote =>
                    quote.staged &&
                    isPreviewQuote(quote) &&
                    quote.source.path === path &&
                    quote.source.mountId === mountId,
            ),
        [quotes, path, mountId],
    )
}

const noteAnchor = (rect: PreviewRect) => ({
    top: rect.top,
    left: rect.left + rect.width / 2,
    bottom: rect.top + rect.height,
})

const pinPoint = (quote: PreviewQuote, rect: PreviewRect) => {
    const {anchor} = quote.source
    // Inside the cell's right edge: its left edge is the table's, which clips.
    if (anchor.type === "cells")
        return {top: rect.top + rect.height / 2, left: rect.left + rect.width - 10}
    return {
        top: rect.top + anchor.point.y * rect.height,
        left: rect.left + anchor.point.x * rect.width,
    }
}

const PinCard = ({
    quote,
    onEdit,
    onDelete,
}: {
    quote: Quote
    onEdit: () => void
    onDelete: () => void
}) => (
    <div className="flex flex-col gap-2" data-quote-ignore="true">
        {quote.note ? (
            <p className="m-0 whitespace-pre-wrap text-[13px] leading-5 text-popover-foreground">
                {quote.note}
            </p>
        ) : null}
        <p className="m-0 line-clamp-3 border-0 border-l-2 border-solid border-border pl-2 text-xs leading-4 text-muted-foreground">
            {truncateQuoteText(quote.text)}
        </p>
        <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={onEdit}>
                Edit
            </Button>
            <Button size="xs" variant="destructive" onClick={onDelete}>
                Delete
            </Button>
        </div>
    </div>
)

export const PreviewCommentLayer = ({
    rootRef,
    sessionId,
    target,
    pick,
    onPickConsumed,
    onDraftClose,
    pinRects,
    touch,
}: PreviewCommentLayerProps) => {
    const [editor, setEditor] = useState<Editor | null>(null)
    const [openPin, setOpenPin] = useState<string | null>(null)
    const comments = usePreviewComments(sessionId, target)
    // Read at pick time: a later target change must not reopen the note.
    const latest = useRef({target, onPickConsumed})
    latest.current = {target, onPickConsumed}

    useEffect(() => {
        if (!pick || !sessionId) return
        setEditor({
            kind: "draft",
            rect: pick.rect,
            quote: {
                id: generateId(),
                text: pick.text,
                note: "",
                staged: false,
                stale: false,
                source: {kind: "preview", ...latest.current.target, anchor: pick.anchor},
            },
        })
        latest.current.onPickConsumed()
    }, [pick, sessionId])

    useEffect(() => {
        if (!sessionId) return
        const quotes = getQuotes(sessionId)
        for (const {id, rect} of pinRects) {
            const quote = quotes.find((held) => held.id === id)
            if (!quote) continue
            if (!rect && !quote.stale) updateQuote(sessionId, id, {stale: true})
            else if (rect && quote.stale) updateQuote(sessionId, id, {stale: false})
        }
    }, [sessionId, pinRects])

    // QuoteNote focuses its field on mount; editing continues after the existing text.
    const editingId = editor?.kind === "edit" ? editor.id : null
    useLayoutEffect(() => {
        if (!editingId) return
        const field = rootRef.current?.querySelector<HTMLTextAreaElement>("[role=dialog] textarea")
        field?.setSelectionRange(field.value.length, field.value.length)
    }, [editingId, rootRef])

    if (!sessionId) return null

    const root = rootRef.current
    const bounds = {width: root?.clientWidth ?? 0, height: root?.clientHeight ?? 0}
    const isTouch = touch ?? hasCoarsePointer()
    const rectOf = (id: string) => pinRects.find((pin) => pin.id === id)?.rect ?? null
    const close = () => {
        if (editor?.kind === "draft") onDraftClose?.()
        setEditor(null)
    }
    // An element scrolled out of the preview keeps its comment but shows no pin.
    const inView = ({top, left}: {top: number; left: number}) =>
        top >= 0 && left >= 0 && top <= bounds.height && left <= bounds.width

    const editing = editor?.kind === "edit" ? comments.find((q) => q.id === editor.id) : null
    const editRect = editing ? rectOf(editing.id) : null

    return (
        <>
            {comments.map((quote, index) => {
                const rect = rectOf(quote.id)
                if (!rect || quote.stale) return null
                const {top, left} = pinPoint(quote, rect)
                if (!inView({top, left})) return null
                const card = (
                    <PinCard
                        quote={quote}
                        onEdit={() => {
                            setOpenPin(null)
                            setEditor({kind: "edit", id: quote.id})
                        }}
                        onDelete={() => {
                            setOpenPin(null)
                            removeQuote(sessionId, quote.id)
                        }}
                    />
                )
                const pin = (
                    <button
                        type="button"
                        data-quote-ignore="true"
                        aria-label={`Comment ${index + 1}`}
                        className={`absolute z-20 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-primary p-0 text-[11px] font-semibold leading-none text-btn-primary-fg shadow-md ring-2 ring-background ${
                            isTouch ? "size-7" : "size-5"
                        }`}
                        style={{top, left}}
                    >
                        {index + 1}
                    </button>
                )
                const open = openPin === quote.id
                const onOpenChange = (next: boolean) => setOpenPin(next ? quote.id : null)
                return isTouch ? (
                    <Popover key={quote.id} open={open} onOpenChange={onOpenChange}>
                        <PopoverTrigger asChild>{pin}</PopoverTrigger>
                        <PopoverContent className="w-64 p-3">{card}</PopoverContent>
                    </Popover>
                ) : (
                    <HoverCard
                        key={quote.id}
                        open={open}
                        onOpenChange={onOpenChange}
                        openDelay={150}
                        closeDelay={100}
                    >
                        <HoverCardTrigger asChild>{pin}</HoverCardTrigger>
                        <HoverCardContent className="p-3">{card}</HoverCardContent>
                    </HoverCard>
                )
            })}
            {editor?.kind === "draft" ? (
                <QuoteNote
                    key={editor.quote.id}
                    quote={editor.quote}
                    anchor={noteAnchor(editor.rect)}
                    bounds={bounds}
                    onStage={(note) => {
                        addQuote(sessionId, {...editor.quote, note, staged: true})
                        close()
                    }}
                    onSend={(note) => {
                        addQuote(sessionId, {...editor.quote, note, staged: true})
                        close()
                        submitSessionMessage(sessionId)
                    }}
                    onCancel={close}
                />
            ) : null}
            {editing && editRect ? (
                <QuoteNote
                    key={`edit-${editing.id}`}
                    quote={editing}
                    anchor={noteAnchor(editRect)}
                    bounds={bounds}
                    initialNote={editing.note}
                    onStage={(note) => {
                        updateQuote(sessionId, editing.id, {note})
                        close()
                    }}
                    onSend={(note) => {
                        updateQuote(sessionId, editing.id, {note})
                        close()
                    }}
                    onCancel={close}
                />
            ) : null}
        </>
    )
}
