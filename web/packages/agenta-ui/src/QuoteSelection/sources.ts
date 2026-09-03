/**
 * The bridge between a quotable DOM node and the raw text it was rendered from.
 *
 * Streamdown parses a message into independently-parsed blocks, so hast `node.position` offsets
 * are block-relative rather than message-relative — the rendered DOM cannot tell us where a
 * selection sits in the source. Instead each quotable body registers its own source text under a
 * key it also stamps on the element (`data-quote-source`), and the selection handler looks the
 * text up and locates the excerpt with `findInSource`.
 *
 * Keeping the text in a Map rather than a data attribute matters: a file body can be hundreds of
 * kilobytes, and that is not something to serialise into the DOM on every render.
 */
import {useEffect} from "react"

const sources = new Map<string, string>()

export const getQuoteSource = (key: string): string | undefined => sources.get(key)

/** Publish the raw source for a quotable body for as long as it is mounted. */
export const useQuoteSource = (key: string | null | undefined, text: string | undefined) => {
    useEffect(() => {
        if (!key || typeof text !== "string") return
        sources.set(key, text)
        return () => {
            sources.delete(key)
        }
    }, [key, text])
}

/** Live DOM ranges for quotes, kept out of the serialisable quote itself. */
const ranges = new Map<string, Range>()

export const setQuoteRange = (id: string, range: Range | null) => {
    if (range) ranges.set(id, range)
    else ranges.delete(id)
}

export const getQuoteRange = (id: string): Range | undefined => ranges.get(id)

export const dropQuoteRange = (id: string) => ranges.delete(id)
