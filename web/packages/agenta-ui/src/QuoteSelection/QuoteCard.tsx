/**
 * The excerpt as it reads inside the note box and on a composer chip: the origin line, the
 * `source` / `source changed` badge, the truncated text, and a dismiss.
 */
import {describeQuoteSource, truncateQuoteText, type Quote} from "@agenta/shared/quotes"
import {FileText, Quotes, X} from "@phosphor-icons/react"

export const QuoteSourceBadge = ({stale}: {stale: boolean}) => (
    <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
            stale
                ? "bg-colorWarningBg text-colorWarning"
                : "bg-colorFillTertiary text-colorTextTertiary"
        }`}
    >
        {stale ? "source changed" : "source"}
    </span>
)

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
            className={`flex items-start gap-2 rounded-md border-0 border-l-2 border-solid border-colorPrimary bg-colorFillQuaternary px-2.5 py-2 ${className}`}
        >
            <Icon size={14} className="mt-0.5 shrink-0 text-colorTextTertiary" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[11px] text-colorTextTertiary">
                        {describeQuoteSource(quote.source)}
                    </span>
                    <QuoteSourceBadge stale={quote.stale} />
                </div>
                <span className="line-clamp-3 break-words text-xs text-colorText">
                    {truncateQuoteText(quote.text, 220)}
                </span>
            </div>
            {onRemove ? (
                <button
                    type="button"
                    aria-label="Remove quote"
                    onClick={onRemove}
                    className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-colorTextTertiary hover:bg-colorFillTertiary hover:text-colorText"
                >
                    <X size={12} />
                </button>
            ) : null}
        </div>
    )
}
