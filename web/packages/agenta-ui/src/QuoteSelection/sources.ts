// Raw source text per quotable body, keyed by its `data-quote-source`; too large for the DOM.
import {useEffect} from "react"

const sources = new Map<string, string>()

export const getQuoteSource = (key: string): string | undefined => sources.get(key)

export const useQuoteSource = (key: string | null | undefined, text: string | undefined) => {
    useEffect(() => {
        if (!key || typeof text !== "string") return
        sources.set(key, text)
        return () => {
            sources.delete(key)
        }
    }, [key, text])
}
