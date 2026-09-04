/**
 * The excerpt as it reads inside the note box: the quoted text and a dismiss. The origin is
 * already obvious — the box is anchored on the span it came from — so it carries no label.
 */
import {truncateQuoteText, type Quote} from "@agenta/shared/quotes"
import {FileText, Quotes, X} from "@phosphor-icons/react"

export const QuoteCard = ({
    quote,
    onRemove,
    className = "",
}: {
    quote: Quote
    onRemove?: () => void
    className?: string
}) => {
    const Icon = quote.source.kind === "file" ? FileText : Quotes
    return (
        <div
            className={`flex items-start gap-2 rounded-[10px] border-0 bg-colorFillQuaternary px-2.5 py-2 ${className}`}
        >
            <Icon size={14} className="mt-0.5 shrink-0 text-colorTextTertiary" />
            <span className="line-clamp-2 min-w-0 flex-1 break-words text-xs text-colorText">
                {truncateQuoteText(quote.text, 220)}
            </span>
            {onRemove ? (
                <button
                    type="button"
                    aria-label="Remove quote"
                    onClick={onRemove}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent text-colorTextTertiary hover:bg-colorFillTertiary hover:text-colorText"
                >
                    <X size={15} />
                </button>
            ) : null}
        </div>
    )
}
