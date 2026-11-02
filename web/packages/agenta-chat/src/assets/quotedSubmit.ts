import {quotesToMarkdown} from "@agenta/shared/quotes"
import {clearQuotes, getQuotes, restoreQuotes} from "@agenta/ui/quote-selection"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

/** A composer submit: a synchronous `false` refuses the send and keeps the text in the editor. */
export type QuotedSend = (text: string) => void | boolean | Promise<void | boolean>

/** Send with the staged quotes prepended; a refused send gets its chips back. */
export const withStagedQuotes =
    (sessionId: string, send: QuotedSend, getEditor: () => RichChatInputHandle | null) =>
    (text: string): void | boolean | Promise<void | boolean> => {
        const staged = getQuotes(sessionId).filter((quote) => quote.staged)
        if (!staged.length) return send(text)
        clearQuotes(sessionId)
        const sentMarkdown = quotesToMarkdown(staged, text)
        const result = send(sentMarkdown)
        // Refused at once: the editor still holds the text, so only the chips come back.
        if (result === false) {
            restoreQuotes(sessionId, staged)
            return false
        }
        // A send that did not go out gets the chips and the typed text back, not the markdown.
        const restore = () => {
            // Over a newer draft the host kept the message elsewhere; leave that draft alone.
            const held = getEditor()?.getMarkdown() ?? ""
            if (held !== "" && held !== sentMarkdown) return
            restoreQuotes(sessionId, staged)
            void getEditor()?.setMarkdown(text)
        }
        return Promise.resolve(result).then(
            (sent) => {
                if (sent === false) restore()
                return sent
            },
            (error: unknown) => {
                restore()
                throw error
            },
        )
    }
