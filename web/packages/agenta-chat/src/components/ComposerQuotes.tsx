// Staged quotes as square tiles in the composer header, beside `ComposerAttachments`.
import {
    formatLineRange,
    formatPreviewChipLocation,
    truncateQuoteText,
    type Quote,
} from "@agenta/shared/quotes"
import {ChatCircleText, FileText, Quotes, X} from "@phosphor-icons/react"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {SESSION_SPRING} from "../assets/motion"

import {ATTACHMENT_TILE as TILE, ATTACHMENT_TILE_CORNER as CORNER_BUTTON} from "./attachmentTile"

const ITEM_VARIANTS = {
    initial: {opacity: 0, scale: 0.9},
    animate: {opacity: 1, scale: 1},
    exit: {opacity: 0, scale: 0.9},
}

interface ComposerQuotesProps {
    quotes: Quote[]
    onRemove: (id: string) => void
    /** Show a preview comment on its file, where its pin card can edit or delete it. */
    onOpen?: (id: string) => void
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

/** One staged quote as a square tile, the same size and corner action as an attachment card. */
const QuoteTile = ({
    quote,
    onRemove,
    onOpen,
}: {
    quote: Quote
    onRemove: () => void
    onOpen?: () => void
}) => {
    const origin = quoteOrigin(quote)
    const preview = quote.source.kind === "preview"
    const Icon = preview ? ChatCircleText : origin ? FileText : Quotes
    const note = quote.note.trim()
    // The note is what the user asked; without it on the tile they retype it.
    const body = truncateQuoteText(note || quote.text, 80)
    const face = (
        <>
            <span className="flex w-full items-center gap-1">
                <Icon size={12} className="shrink-0 text-colorTextTertiary" />
                {origin ? (
                    <span className="min-w-0 truncate font-mono text-[9px] leading-3 text-colorTextTertiary">
                        {origin.fileName}
                    </span>
                ) : null}
                {quote.stale ? (
                    <span className="truncate rounded bg-colorWarning/20 px-1 text-[9px] font-medium leading-3 text-colorWarning">
                        changed
                    </span>
                ) : null}
            </span>
            <span
                className={`w-full overflow-hidden text-left text-[11px] leading-3 text-colorText ${
                    origin ? "line-clamp-3" : "line-clamp-4"
                }`}
            >
                {body}
            </span>
            {origin?.location ? (
                <span
                    data-quote-range
                    className="mt-auto w-full truncate font-mono text-[9px] leading-3 text-colorTextTertiary"
                >
                    {origin.location}
                </span>
            ) : null}
        </>
    )
    const title = origin
        ? `${origin.displayPath}${origin.location ? ` ${origin.location}` : ""}`
        : note
          ? truncateQuoteText(quote.text)
          : undefined
    const faceClass =
        "absolute inset-0 flex flex-col items-start gap-1 border-0 bg-transparent p-1.5 text-left"
    return (
        <div
            className={`group/attachment ${TILE} ${
                quote.stale ? "!border-colorWarningBorder !bg-colorWarningBg" : ""
            }`}
        >
            {preview && onOpen ? (
                <button
                    type="button"
                    aria-label="Show comment on the file"
                    title={title}
                    onClick={onOpen}
                    className={`${faceClass} cursor-pointer`}
                >
                    {face}
                </button>
            ) : (
                <div className={faceClass} title={title}>
                    {face}
                </div>
            )}
            <button
                type="button"
                aria-label="Remove quote"
                onClick={onRemove}
                className={CORNER_BUTTON}
            >
                <X size={10} weight="bold" />
            </button>
        </div>
    )
}

/** The tiles alone, for a row they share with the attachment cards. */
export const QuoteTiles = ({quotes, onRemove, onOpen}: ComposerQuotesProps) => (
    <AnimatePresence initial={false} mode="popLayout">
        {quotes.map((quote) => (
            <motion.div
                key={quote.id}
                layout
                variants={ITEM_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
            >
                <QuoteTile
                    quote={quote}
                    onRemove={() => onRemove(quote.id)}
                    onOpen={onOpen ? () => onOpen(quote.id) : undefined}
                />
            </motion.div>
        ))}
    </AnimatePresence>
)

export const ComposerQuotes = (props: ComposerQuotesProps) => {
    if (props.quotes.length === 0) return null
    return (
        <MotionConfig transition={SESSION_SPRING}>
            <div className="flex flex-wrap gap-2 p-2">
                <QuoteTiles {...props} />
            </div>
        </MotionConfig>
    )
}

export default ComposerQuotes
