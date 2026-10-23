// Comments on a rendered preview: note box at a pick, numbered pins, pin card with Edit and Delete.
import {
    Fragment,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react"

import type {PinQuery} from "@agenta/shared/previewPicker"
import {
    isPreviewQuote,
    previewCommentNumber,
    truncateQuoteText,
    type ElementAnchor,
    type PreviewAnchor,
    type PreviewQuote,
    type Quote,
} from "@agenta/shared/quotes"
import {generateId} from "@agenta/shared/utils"

import {Button} from "../components/ui/button"
import {HoverCard, HoverCardContent, HoverCardTrigger} from "../components/ui/hover-card"
import {hasCoarsePointer} from "../hooks/useVisualViewport"

import {QuoteNote} from "./QuoteNote"
import {CommentSheet, QuoteNoteSheet} from "./QuoteNoteSheet"
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

type Editor =
    | {kind: "draft"; quote: Quote; rect: PreviewRect; note: string}
    | {kind: "edit"; id: string}

/** Staged comments and the open draft on this target; the bridges track each one's element. */
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
                    isPreviewQuote(quote) &&
                    quote.source.path === path &&
                    quote.source.mountId === mountId,
            ),
        [quotes, path, mountId],
    )
}

/** A rect in an iframe's viewport, moved into the root's coordinates. */
export const frameRectToRoot = (
    rect: PreviewRect,
    frame: HTMLElement,
    root: HTMLElement,
): PreviewRect => {
    const f = frame.getBoundingClientRect()
    const r = root.getBoundingClientRect()
    return {...rect, top: rect.top + f.top - r.top, left: rect.left + f.left - r.left}
}

/** Element comments as the picker's pin queries; `keep` narrows them (a slide's comments). */
export const toPinQueries = (
    comments: PreviewQuote[],
    keep: (anchor: ElementAnchor) => boolean = () => true,
): PinQuery[] =>
    comments.flatMap(({id, text, source: {anchor}}) =>
        anchor.type === "element" && keep(anchor) ? [{id, selector: anchor.selector, text}] : [],
    )

const draftField = (root: HTMLElement | null) =>
    root?.querySelector<HTMLTextAreaElement>("[role=dialog] textarea") ?? null

const noteAnchor = (rect: PreviewRect) => ({
    top: rect.top,
    left: rect.left + rect.width / 2,
    bottom: rect.top + rect.height,
})

const pinPoint = (quote: PreviewQuote, rect: PreviewRect) => {
    const {anchor} = quote.source
    // The pin's tail sits just inside the cell's top-right corner.
    if (anchor.type === "cells") return {top: rect.top + 6, left: rect.left + rect.width - 6}
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
    const latest = useRef({target, onPickConsumed, editor})
    latest.current = {target, onPickConsumed, editor}

    // The draft lives in the store unstaged (no chip) so the bridges track its element.
    useEffect(() => {
        if (!pick || !sessionId) return
        const current = latest.current.editor
        // A pick while a draft is open moves the draft there, keeping what was typed.
        const typed = current?.kind === "draft" ? (draftField(rootRef.current)?.value ?? "") : ""
        if (current?.kind === "draft") removeQuote(sessionId, current.quote.id)
        const quote: Quote = {
            id: generateId(),
            text: pick.text,
            note: "",
            staged: false,
            stale: false,
            source: {kind: "preview", ...latest.current.target, anchor: pick.anchor},
        }
        addQuote(sessionId, quote)
        setEditor({kind: "draft", rect: pick.rect, note: typed, quote})
        latest.current.onPickConsumed()
    }, [pick, sessionId, rootRef])

    // A draft never outlives its layer (a file switch, the pane closing).
    useEffect(
        () => () => {
            const current = latest.current.editor
            if (sessionId && current?.kind === "draft") removeQuote(sessionId, current.quote.id)
        },
        [sessionId],
    )

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

    // The note box and pins clamp to the root's size; a resized pane re-renders them.
    const [rootSize, setRootSize] = useState<{width: number; height: number} | null>(null)
    useEffect(() => {
        const root = rootRef.current
        if (!root || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(() =>
            setRootSize({width: root.clientWidth, height: root.clientHeight}),
        )
        observer.observe(root)
        return () => observer.disconnect()
    }, [rootRef])

    // QuoteNote focuses its field on mount; typing continues after any text it opens with.
    const editorKey = !editor ? null : editor.kind === "edit" ? editor.id : editor.quote.id
    useLayoutEffect(() => {
        if (!editorKey) return
        const field = draftField(rootRef.current)
        field?.setSelectionRange(field.value.length, field.value.length)
    }, [editorKey, rootRef])

    if (!sessionId) return null

    const root = rootRef.current
    const bounds = rootSize ?? {width: root?.clientWidth ?? 0, height: root?.clientHeight ?? 0}
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
    const draft = editor?.kind === "draft" ? editor : null
    const discardDraft = () => {
        if (draft) removeQuote(sessionId, draft.quote.id)
        close()
    }
    // Follow the element; a cell range's live rect is its first cell, so keep the range's size.
    const draftRect = (() => {
        if (!draft) return null
        const live = rectOf(draft.quote.id)
        if (!live) return draft.rect
        return isPreviewQuote(draft.quote) && draft.quote.source.anchor.type === "cells"
            ? {...draft.rect, top: live.top, left: live.left}
            : live
    })()

    const stageDraft = (note: string) => {
        if (!draft) return
        updateQuote(sessionId, draft.quote.id, {note, staged: true})
        close()
    }
    const sendDraft = (note: string) => {
        stageDraft(note)
        submitSessionMessage(sessionId)
    }
    const saveEdit = (note: string) => {
        if (editing) updateQuote(sessionId, editing.id, {note})
        close()
    }
    const editPin = (id: string) => {
        setOpenPin(null)
        setEditor({kind: "edit", id})
    }
    const deletePin = (id: string) => {
        setOpenPin(null)
        removeQuote(sessionId, id)
    }
    const openQuote = openPin ? comments.find((quote) => quote.id === openPin) : undefined

    return (
        <>
            {comments.map((quote) => {
                const number = previewCommentNumber(comments, quote)
                if (number === null) return null
                const rect = rectOf(quote.id)
                if (!rect || quote.stale) return null
                const {top, left} = pinPoint(quote, rect)
                if (!inView({top, left})) return null
                const card = (
                    <PinCard
                        quote={quote}
                        onEdit={() => editPin(quote.id)}
                        onDelete={() => deletePin(quote.id)}
                    />
                )
                const pin = (
                    <button
                        type="button"
                        data-quote-ignore="true"
                        aria-label={`Comment ${number}`}
                        onClick={isTouch ? () => setOpenPin(quote.id) : undefined}
                        // The square bottom-left corner is the tail; it sits on the commented point.
                        className={`absolute z-20 flex origin-bottom-left -translate-y-full cursor-pointer items-center justify-center rounded-full rounded-bl-none border-0 bg-colorSelection px-1.5 font-semibold leading-none tabular-nums text-colorTextLightSolid shadow-md ring-2 ring-background transition-transform hover:scale-110 ${
                            isTouch
                                ? "h-7 min-w-7 text-xs after:absolute after:-inset-2 after:content-['']"
                                : "h-6 min-w-6 text-[11px]"
                        }`}
                        style={{top, left}}
                    >
                        {number}
                    </button>
                )
                if (isTouch) return <Fragment key={quote.id}>{pin}</Fragment>
                return (
                    <HoverCard
                        key={quote.id}
                        open={openPin === quote.id}
                        onOpenChange={(next) => setOpenPin(next ? quote.id : null)}
                        openDelay={150}
                        closeDelay={100}
                    >
                        <HoverCardTrigger asChild>{pin}</HoverCardTrigger>
                        <HoverCardContent className="p-3">{card}</HoverCardContent>
                    </HoverCard>
                )
            })}
            {isTouch && openQuote ? (
                <CommentSheet
                    quote={openQuote}
                    onEdit={() => editPin(openQuote.id)}
                    onDelete={() => deletePin(openQuote.id)}
                    onClose={() => setOpenPin(null)}
                />
            ) : null}
            {draft && draftRect ? (
                isTouch ? (
                    <QuoteNoteSheet
                        key={draft.quote.id}
                        quote={draft.quote}
                        initialNote={draft.note}
                        onStage={stageDraft}
                        onSend={sendDraft}
                        onCancel={discardDraft}
                    />
                ) : (
                    <QuoteNote
                        key={draft.quote.id}
                        quote={draft.quote}
                        anchor={noteAnchor(draftRect)}
                        bounds={bounds}
                        initialNote={draft.note}
                        onStage={stageDraft}
                        onSend={sendDraft}
                        onCancel={discardDraft}
                    />
                )
            ) : null}
            {editing && (isTouch || editRect) ? (
                isTouch ? (
                    <QuoteNoteSheet
                        key={`edit-${editing.id}`}
                        quote={editing}
                        initialNote={editing.note}
                        onStage={saveEdit}
                        onCancel={close}
                    />
                ) : editRect ? (
                    <QuoteNote
                        key={`edit-${editing.id}`}
                        quote={editing}
                        anchor={noteAnchor(editRect)}
                        bounds={bounds}
                        initialNote={editing.note}
                        onStage={saveEdit}
                        onSend={saveEdit}
                        onCancel={close}
                    />
                ) : null
            ) : null}
        </>
    )
}
