import {normalizeQuoteText, type QuotedExcerpt} from "@agenta/shared/quotes"
import {Quotes} from "@phosphor-icons/react"

const AGENT_REPLY = "Agent reply"

/** One excerpt a sent message quoted, lifted out of the bubble into its own card above it. */
export const UserQuoteCard = ({quote}: {quote: QuotedExcerpt}) => (
    <div className="flex max-w-full gap-2.5 rounded-lg border border-border bg-background px-3.5 py-2.5">
        <Quotes size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[11.5px] font-medium text-muted-foreground">
                {quote.origin === AGENT_REPLY ? (
                    "Quoting agent reply"
                ) : (
                    <>
                        Quoting <span className="font-mono">{quote.origin.split("/").pop()}</span>
                    </>
                )}
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground sm:text-[13px]">
                {normalizeQuoteText(quote.text)}
            </span>
        </div>
    </div>
)
