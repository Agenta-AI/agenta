import {useEffect, useRef, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getRoot, $isTextNode} from "lexical"

import {$isCodeHighlightNode} from "../code/nodes/CodeHighlightNode"

interface SearchPluginProps {
    searchTerm: string
    currentResultIndex: number
    onResultCountChange: (count: number) => void
}

// Extend Window interface for CSS Highlights API
declare global {
    interface Window {
        CSS: {
            highlights: Map<string, Highlight>
        }
    }
    class Highlight {
        constructor(...ranges: Range[])
        priority: number
        type: string
        add(range: Range): void
        clear(): void
        delete(range: Range): boolean
        entries(): IterableIterator<[Range, Range]>
        forEach(
            callback: (range: Range, range2: Range, highlight: Highlight) => void,
            thisArg?: any,
        ): void
        has(range: Range): boolean
        keys(): IterableIterator<Range>
        size: number
        values(): IterableIterator<Range>
    }
}

export const SearchPlugin = ({
    searchTerm,
    currentResultIndex,
    onResultCountChange,
}: SearchPluginProps) => {
    const [editor] = useLexicalComposerContext()
    const lastSearchTerm = useRef("")
    const [matches, setMatches] = useState<{key: string; start: number; end: number}[]>([])

    // Helper to clear highlights
    const clearHighlights = () => {
        if (typeof window !== "undefined" && window.CSS && window.CSS.highlights) {
            window.CSS.highlights.delete("search-results")
            window.CSS.highlights.delete("active-search-match")
        }
    }

    // Inject CSS for highlights
    useEffect(() => {
        const styleId = "agenta-search-highlights"
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style")
            style.id = styleId
            style.textContent = `
                ::highlight(search-results) {
                    background-color: rgba(255, 255, 0, 0.4);
                    color: inherit;
                }
                ::highlight(active-search-match) {
                    background-color: rgba(255, 165, 0, 0.6);
                    color: inherit;
                    text-decoration: underline;
                }
            `
            document.head.appendChild(style)
        }
    }, [])

    // Effect for performing search
    useEffect(() => {
        if (searchTerm === lastSearchTerm.current && matches.length > 0) {
            updateHighlights()
            return
        }

        lastSearchTerm.current = searchTerm

        if (!searchTerm) {
            clearHighlights()
            onResultCountChange(0)
            setMatches([])
            return
        }

        editor.getEditorState().read(() => {
            const root = $getRoot()
            const allTextNodes = root.getAllTextNodes()
            const newMatches: {key: string; start: number; end: number}[] = []

            // Simple regex for case-insensitive search
            const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")

            allTextNodes.forEach((node) => {
                if ($isCodeHighlightNode(node) || $isTextNode(node)) {
                    const text = node.getTextContent()
                    let match
                    // Reset regex index
                    regex.lastIndex = 0
                    while ((match = regex.exec(text)) !== null) {
                        newMatches.push({
                            key: node.getKey(),
                            start: match.index,
                            end: match.index + match[0].length,
                        })
                    }
                }
            })

            setMatches(newMatches)
            onResultCountChange(newMatches.length)
        })
    }, [searchTerm, editor])

    // Effect for updating highlights when matches or index change
    useEffect(() => {
        updateHighlights()
    }, [matches, currentResultIndex])

    const updateHighlights = () => {
        if (typeof window === "undefined" || !window.CSS || !window.CSS.highlights) return

        // We need to access DOM nodes, so we must be inside editor.update or read,
        // OR rely on editor.getElementByKey which works if committed.
        // Since we are in useEffect, render is committed.

        editor.getEditorState().read(() => {
            const searchRanges: Range[] = []
            const activeRanges: Range[] = []

            matches.forEach((match, index) => {
                const element = editor.getElementByKey(match.key)
                if (!element) return

                // CodeHighlightNode renders a span. The text is the first child.
                // If it's empty text node, it might not have child text node?
                // But matches implies text length > 0.

                const textNode = element.firstChild
                if (!textNode) return

                try {
                    const range = document.createRange()
                    // Start and end are relative to the text node content
                    range.setStart(textNode, match.start)
                    range.setEnd(textNode, match.end)

                    searchRanges.push(range)

                    if (index === currentResultIndex) {
                        activeRanges.push(range)

                        // Scroll active match into view
                        // We can use the range to get bounding rect or scroll the element
                        // element.scrollIntoView works but scrolls the whole line/token.
                        // Better: scroll the range?
                        // element.scrollIntoView is simpler.
                        if (activeRanges.length === 1) {
                            // Only scroll for the first active range (should be only 1)
                            // Use scrollIntoView with block: 'center' to avoid jumping too much
                            // But wait, if we are typing, we might not want to scroll unless we explicitly navigated?
                            // User said "cursor moves...".
                            // Let's only scroll if we navigated (currentResultIndex changed) OR first search?
                            // This effect runs on both.
                            // Basic scroll is fine.
                            const rect = range.getBoundingClientRect()
                            // Simple check if visible?
                            element.scrollIntoView({
                                block: "center",
                                inline: "nearest",
                                behavior: "smooth",
                            })
                        }
                    }
                } catch (e) {
                    console.warn("Failed to create range for search match", e)
                }
            })

            const searchHighlight = new Highlight(...searchRanges)
            const activeHighlight = new Highlight(...activeRanges)

            window.CSS.highlights.set("search-results", searchHighlight)
            window.CSS.highlights.set("active-search-match", activeHighlight)
        })
    }

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            clearHighlights()
        }
    }, [])

    return null
}
