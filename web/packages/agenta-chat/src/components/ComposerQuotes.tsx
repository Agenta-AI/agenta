// Staged quotes as chips in the composer header, beside `ComposerAttachments`.
import {useState} from "react"

import {
    formatLineRange,
    formatPreviewChipLocation,
    previewCommentNumber,
    truncateQuoteText,
    type Quote,
} from "@agenta/shared/quotes"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {ChatCircleText, FileText, Quotes, X} from "@phosphor-icons/react"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {SESSION_SPRING} from "../assets/motion"

const ITEM_VARIANTS = {
    initial: {opacity: 0, scale: 0.9},
    animate: {opacity: 1, scale: 1},
    exit: {opacity: 0, scale: 0.9},
}

interface ComposerQuotesProps {
    quotes: Quote[]
    onRemove: (id: string) => void
    /** Save a preview comment's edited note; its chip opens the editor on click. */
    onEdit?: (id: string, note: string) => void
    /** Larger hit targets on a touch screen, per the shared convention. */
    touch?: boolean
}

const NoteEditor = ({note, onSave}: {note: string; onSave: (note: string) => void}) => {
    const [value, setValue] = useState(note)
    return (
        <textarea
            autoFocus
            aria-label="Edit comment"
            // Editing continues after the existing note.
            onFocus={(e) => e.currentTarget.setSelectionRange(value.length, value.length)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
                e.preventDefault()
                onSave(value)
            }}
            rows={3}
            placeholder="Ask about this…"
            className="w-full resize-none border-0 bg-transparent p-0 font-[inherit] text-[13px] leading-5 text-popover-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
    )
}

const quoteOrigin = (quote: Quote) => {
    const {source} = quote
    if (source.kind === "file")
        return {
            displayPath: source.displayPath,
            fileName: source.fileName,
            location: formatLineRange(source.startLine, source.endLine),
        }
    if (source.kind === "preview")
        return {
            displayPath: source.displayPath,
            fileName: source.fileName,
            location: formatPreviewChipLocation(source.anchor),
        }
    return null
}

const QuoteChip = ({
    quote,
    number,
    onRemove,
    onEdit,
    touch,
}: {
    quote: Quote
    /** The comment's pin number on its document; null for other quotes. */
    number: number | null
    onRemove: () => void
    onEdit?: (note: string) => void
    touch?: boolean
}) => {
    const [editing, setEditing] = useState(false)
    const origin = quoteOrigin(quote)
    const preview = quote.source.kind === "preview"
    const Icon = preview ? ChatCircleText : origin ? FileText : Quotes
    const label = (
        <>
            {number !== null ? (
                <span
                    aria-label={`Comment ${number}`}
                    className={`flex shrink-0 items-center justify-center rounded-full rounded-bl-none bg-colorSelection px-1 text-[10px] font-semibold leading-none tabular-nums text-colorTextLightSolid ${
                        touch ? "h-[18px] min-w-[18px]" : "h-4 min-w-4"
                    }`}
                >
                    {number}
                </span>
            ) : (
                <Icon size={touch ? 14 : 12} className="shrink-0 text-colorTextTertiary" />
            )}
            <span className="min-w-6 truncate text-xs text-colorText">
                {truncateQuoteText(preview && quote.note ? quote.note : quote.text, 48)}
            </span>
            {origin ? (
                <>
                    <span className="h-3 w-px shrink-0 bg-colorBorderSecondary" aria-hidden />
                    <span className="min-w-8 truncate font-mono text-[10px] text-colorTextTertiary">
                        {origin.fileName}
                    </span>
                    {origin.location ? (
                        <span
                            data-quote-range
                            className="-ml-0.5 shrink-0 font-mono text-[10px] text-colorTextTertiary"
                        >
                            {origin.location}
                        </span>
                    ) : null}
                </>
            ) : null}
        </>
    )
    return (
        // Only the excerpt and the file name give way; the range, the tag and the remove button
        // keep their width so a long file name can never push them out of the chip.
        <div
            title={
                origin
                    ? `${origin.displayPath}${origin.location ? ` ${origin.location}` : ""}`
                    : undefined
            }
            className={`flex min-w-0 max-w-[320px] items-center gap-1.5 rounded-lg border border-solid px-2 ${
                touch ? "h-8" : "h-7"
            } ${
                quote.stale
                    ? "border-colorWarningBorder bg-colorWarningBg"
                    : "border-colorBorderSecondary bg-colorFillQuaternary"
            }`}
        >
            {preview && onEdit ? (
                <Popover open={editing} onOpenChange={setEditing}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label="Edit comment"
                            className="flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0"
                        >
                            {label}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-3">
                        <NoteEditor
                            note={quote.note}
                            onSave={(note) => {
                                onEdit(note)
                                setEditing(false)
                            }}
                        />
                    </PopoverContent>
                </Popover>
            ) : (
                label
            )}
            {quote.stale ? (
                <span className="shrink-0 rounded bg-colorWarning/20 px-1.5 text-[10px] font-medium leading-4 text-colorWarning">
                    changed
                </span>
            ) : null}
            <button
                type="button"
                aria-label="Remove quote"
                onClick={onRemove}
                className={`flex shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-colorTextTertiary hover:text-colorText ${
                    touch ? "h-5 w-5" : "h-4 w-4"
                }`}
            >
                <X size={touch ? 12 : 10} />
            </button>
        </div>
    )
}

export const ComposerQuotes = ({quotes, onRemove, onEdit, touch}: ComposerQuotesProps) => {
    if (quotes.length === 0) return null
    return (
        <MotionConfig transition={SESSION_SPRING}>
            <div className="flex flex-col p-2 pb-1">
                <div className="flex max-h-[76px] flex-wrap gap-1.5 overflow-y-auto">
                    <AnimatePresence initial={false} mode="popLayout">
                        {quotes.map((quote) => (
                            <motion.div
                                key={quote.id}
                                className="min-w-0 max-w-full"
                                layout
                                variants={ITEM_VARIANTS}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                            >
                                <QuoteChip
                                    quote={quote}
                                    number={previewCommentNumber(quotes, quote)}
                                    onRemove={() => onRemove(quote.id)}
                                    onEdit={onEdit ? (note) => onEdit(quote.id, note) : undefined}
                                    touch={touch}
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            </div>
        </MotionConfig>
    )
}

export default ComposerQuotes
