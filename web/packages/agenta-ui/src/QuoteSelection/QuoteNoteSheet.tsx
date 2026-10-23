// Touch counterparts of the anchored note box and pin card: bottom sheets that sit on the keyboard.
import {useState, type ReactNode} from "react"

import {truncateQuoteText, type Quote} from "@agenta/shared/quotes"
import {Quotes} from "@phosphor-icons/react"

import {Button} from "../components/ui/button"
import {Sheet, SheetContent, SheetTitle} from "../components/ui/sheet"
import {VIEWPORT_HEIGHT_VAR} from "../hooks/useVisualViewport"

// iOS lays the keyboard over the page; `useVisualViewportHeight` publishes the visible height.
const ABOVE_KEYBOARD = {bottom: `calc(100dvh - var(${VIEWPORT_HEIGHT_VAR}, 100dvh))`}

const TouchSheet = ({
    title,
    onClose,
    children,
}: {
    title: string
    onClose: () => void
    children: ReactNode
}) => (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent
            side="bottom"
            aria-describedby={undefined}
            data-quote-ignore="true"
            style={ABOVE_KEYBOARD}
            className="max-h-[70vh] gap-3 rounded-t-2xl border-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-drawer-bottom"
        >
            <SheetTitle className="sr-only">{title}</SheetTitle>
            {children}
        </SheetContent>
    </Sheet>
)

const Excerpt = ({quote}: {quote: Quote}) => (
    <div className="flex gap-2.5 rounded-lg bg-foreground/5 px-3.5 py-3">
        <Quotes size={14} weight="fill" className="mt-[3px] shrink-0 text-muted-foreground" />
        <p className="m-0 line-clamp-3 text-[13px] leading-5 text-muted-foreground">
            {truncateQuoteText(quote.text, 220)}
        </p>
    </div>
)

/** The note box on a touch screen. Without `onSend` it edits a staged note and only saves. */
export const QuoteNoteSheet = ({
    quote,
    initialNote,
    onStage,
    onSend,
    onCancel,
}: {
    quote: Quote
    initialNote?: string
    onStage: (note: string) => void
    onSend?: (note: string) => void
    onCancel: () => void
}) => {
    const [note, setNote] = useState(initialNote ?? "")
    return (
        <TouchSheet title="Comment" onClose={onCancel}>
            <Excerpt quote={quote} />
            <textarea
                autoFocus
                aria-label="Comment"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onFocus={(e) => e.currentTarget.setSelectionRange(note.length, note.length)}
                rows={2}
                placeholder="Ask about this…"
                className="min-h-11 w-full resize-none rounded-lg border border-solid border-border bg-transparent px-3 py-2.5 font-[inherit] text-[15px] leading-6 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-ring"
            />
            {onSend ? (
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-11" onClick={() => onStage(note)}>
                        Add to message
                    </Button>
                    <Button className="h-11" onClick={() => onSend(note)}>
                        Send now
                    </Button>
                </div>
            ) : (
                <Button className="h-11" onClick={() => onStage(note)}>
                    Save
                </Button>
            )}
        </TouchSheet>
    )
}

/** A pin's details on a touch screen: the note, the excerpt, Edit and Delete. */
export const CommentSheet = ({
    quote,
    onEdit,
    onDelete,
    onClose,
}: {
    quote: Quote
    onEdit: () => void
    onDelete: () => void
    onClose: () => void
}) => (
    <TouchSheet title="Comment" onClose={onClose}>
        {quote.note ? (
            <p className="m-0 whitespace-pre-wrap text-[15px] leading-6 text-foreground">
                {quote.note}
            </p>
        ) : null}
        <Excerpt quote={quote} />
        <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" onClick={onEdit}>
                Edit
            </Button>
            <Button variant="destructive" className="h-11" onClick={onDelete}>
                Delete
            </Button>
        </div>
    </TouchSheet>
)
