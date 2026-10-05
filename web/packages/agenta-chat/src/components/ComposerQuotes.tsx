// Staged quotes as chips in the composer header, beside `ComposerAttachments`.
import {formatLineRange, truncateQuoteText, type Quote} from "@agenta/shared/quotes"
import {FileText, Quotes, X} from "@phosphor-icons/react"
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
    /** Larger hit targets on a touch screen, per the shared convention. */
    touch?: boolean
}

const QuoteChip = ({
    quote,
    onRemove,
    touch,
}: {
    quote: Quote
    onRemove: () => void
    touch?: boolean
}) => {
    const file = quote.source.kind === "file" ? quote.source : null
    const Icon = file ? FileText : Quotes
    const range = file ? formatLineRange(file.startLine, file.endLine) : ""
    return (
        <div
            className={`flex max-w-[280px] items-center gap-1.5 rounded-lg border border-solid px-2 ${
                touch ? "h-8" : "h-7"
            } ${
                quote.stale
                    ? "border-colorWarningBorder bg-colorWarningBg"
                    : "border-colorBorderSecondary bg-colorFillQuaternary"
            }`}
        >
            <Icon size={touch ? 14 : 12} className="shrink-0 text-colorTextTertiary" />
            <span className="truncate text-xs text-colorText">
                {truncateQuoteText(quote.text, 48)}
            </span>
            {file ? (
                <>
                    <span className="h-3 w-px shrink-0 bg-colorBorderSecondary" aria-hidden />
                    <span className="shrink-0 truncate font-mono text-[10px] text-colorTextTertiary">
                        {file.fileName}
                        {range ? ` ${range}` : ""}
                    </span>
                </>
            ) : null}
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

export const ComposerQuotes = ({quotes, onRemove, touch}: ComposerQuotesProps) => {
    if (quotes.length === 0) return null
    return (
        <MotionConfig transition={SESSION_SPRING}>
            <div className="flex flex-col p-2 pb-1">
                <div className="flex max-h-[76px] flex-wrap gap-1.5 overflow-y-auto">
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
                                <QuoteChip
                                    quote={quote}
                                    onRemove={() => onRemove(quote.id)}
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
