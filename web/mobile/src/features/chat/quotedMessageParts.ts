import {splitQuotedMessage, type QuotedExcerpt} from "@agenta/shared/quotes"

export type QuotedMessagePart = {kind: "quote"; quote: QuotedExcerpt} | {kind: "text"; text: string}

/** A sent message in reading order: each quote, the note under it, then the message itself. */
export const quotedMessageParts = (markdown: string): QuotedMessagePart[] => {
    const parts: QuotedMessagePart[] = []
    const pushText = (text: string) => {
        if (!text.trim()) return
        const last = parts.at(-1)
        if (last?.kind === "text") last.text = `${last.text}\n\n${text}`
        else parts.push({kind: "text", text})
    }
    // `quotesToMarkdown` ends every quote block at a blank line, so a block is a quote or prose.
    for (const block of markdown.split(/\n{2,}/)) {
        const {quotes, text} = splitQuotedMessage(block)
        for (const quote of quotes) parts.push({kind: "quote", quote})
        pushText(quotes.length ? text : block)
    }
    return parts
}
