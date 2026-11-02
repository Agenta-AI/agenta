import {normalizeQuoteText, type QuotedExcerpt} from "@agenta/shared/quotes"

const AGENT_REPLY = "Agent reply"

const cells = (row: string) =>
    row
        .replace(/^\s*\||\|\s*$/g, "")
        .split("|")
        .map((cell) => cell.trim())

/** A pipe table read as "Plan 150 · Actual 160": each header beside its value. */
const plainTable = (lines: string[]): string => {
    const [head, ...rows] = lines.filter((line) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(line)).map(cells)
    if (!head) return ""
    if (rows.length !== 1) return [head, ...rows].map((row) => row.join(" ")).join(" · ")
    return head.map((label, at) => `${label} ${rows[0][at] ?? ""}`.trim()).join(" · ")
}

/** Plain reading text for a clamped excerpt: markdown marks would show as literal characters. */
const plainExcerpt = (text: string) => {
    const lines = text
        .replace(/^>\s?/gm, "")
        .replace(/`+|\*\*/g, "")
        .split("\n")
    const table = lines.filter((line) => line.trim().startsWith("|"))
    const rest = lines.filter((line) => !line.trim().startsWith("|"))
    return normalizeQuoteText([plainTable(table), ...rest].join(" "))
}

/** One quote inside a sent message: a ruled block with its source over the excerpt. */
export const UserQuoteBlock = ({quote}: {quote: QuotedExcerpt}) => {
    const excerpt = plainExcerpt(quote.text)
    return (
        <div
            title={excerpt}
            className="flex min-w-0 flex-col gap-0.5 border-0 border-l-2 border-solid border-border pl-3"
        >
            <span className="truncate text-[11.5px] text-muted-foreground/80">
                {quote.origin === AGENT_REPLY ? (
                    "Agent reply"
                ) : (
                    <span className="font-mono">{quote.origin.split("/").pop()}</span>
                )}
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground sm:text-[13px]">
                {excerpt}
            </span>
        </div>
    )
}
