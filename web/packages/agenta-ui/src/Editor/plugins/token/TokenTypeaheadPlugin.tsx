import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {autoUpdate, flip, offset, shift, useFloating} from "@floating-ui/react"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getNodeByKey, $getSelection, $isRangeSelection} from "lexical"
import {createPortal} from "react-dom"

import {navigateCursor} from "./assets/selectionUtils"
import {$isTokenNode} from "./TokenNode"

interface TokenMenuPluginProps {
    tokens: string[]
}

export function TokenMenuPlugin({tokens}: TokenMenuPluginProps) {
    const [editor] = useLexicalComposerContext()
    const [anchor, setAnchor] = useState<{element: HTMLElement; key: string} | null>(null)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [inputQuery, setInputQuery] = useState("")
    const containerRef = useRef<HTMLDivElement>(null)
    const selectedItemRef = useRef<HTMLDivElement>(null)

    // Floating UI setup
    const {refs, floatingStyles} = useFloating({
        open: !!anchor,
        placement: "bottom-start",
        middleware: [
            offset(4), // 4px gap from reference element
            flip(), // Flip to top if no space below
            shift({padding: 8}), // Keep within viewport with 8px padding
        ],
        whileElementsMounted: autoUpdate, // Auto-update position on scroll/resize
    })

    // Update reference element when anchor changes
    useEffect(() => {
        if (anchor) {
            refs.setReference(anchor.element)
        } else {
            refs.setReference(null)
        }
    }, [anchor, refs, editor])

    const dynamicallyReadingTokens = useMemo(() => {
        if (tokens.length) {
            const uniqueTokens = new Set(tokens)
            return Array.from(uniqueTokens).filter(Boolean)
        }

        const tokenNodes = window.document.querySelectorAll(".token-node")
        const _tokens = Array.from(tokenNodes).map((node) =>
            node.textContent?.replace("{{", "").replace("}}", ""),
        )
        const uniqueTokens = new Set(_tokens)
        return Array.from(uniqueTokens).filter(Boolean)
    }, [tokens])

    // Filter tokens based on current input
    const filteredTokens = useMemo(() => {
        const _tokens = dynamicallyReadingTokens
        if (!inputQuery) {
            return _tokens
        }

        return _tokens.filter((token) => token?.includes(inputQuery) && token !== inputQuery)
    }, [dynamicallyReadingTokens, inputQuery])

    // Handle token selection
    const selectOption = useCallback(
        (token: string) => {
            if (!anchor) return

            editor.update(() => {
                const node = $getNodeByKey(anchor.key)
                if ($isTokenNode(node)) {
                    node.setTextContent(`{{${token}}}`)
                    navigateCursor({
                        nodeKey: node.getKey(),
                        offset: node.getTextContent().length,
                    })
                }
            })

            // Reset state
            setAnchor(null)
            setSelectedIndex(0)
            setInputQuery("")
        },
        [anchor, editor],
    )

    // Track token node changes
    useEffect(() => {
        return editor.registerUpdateListener(() => {
            editor.getEditorState().read(() => {
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                    setAnchor(null)
                    return
                }

                const node = selection.anchor.getNode()

                if ($isTokenNode(node)) {
                    const text = node.getTextContent()
                    // Match the token content with or without cursor
                    const match = text.match(/^\{\{(.*?)\}\}$/)

                    // Get cursor position relative to the node
                    const offset = selection.anchor.offset

                    // If we have a match and the cursor is between the double braces
                    if (match && offset >= 2 && offset <= text.length - 2) {
                        const tokenContent = match[1]
                        setInputQuery(tokenContent)
                        const dom = editor.getElementByKey(node.getKey())
                        if (dom) {
                            setAnchor({element: dom, key: node.getKey()})
                            return
                        }
                    }
                }
                setAnchor(null)
                setInputQuery("")
            })
        })
    }, [editor])

    // Handle clicks outside
    useEffect(() => {
        if (!anchor) return

        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setAnchor(null)
            }
        }

        const timer = setTimeout(() => {
            document.addEventListener("click", handleClickOutside, true)
        }, 10)

        return () => {
            clearTimeout(timer)
            document.removeEventListener("click", handleClickOutside, true)
        }
    }, [anchor])

    // Handle keyboard navigation
    useEffect(() => {
        if (!anchor) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) return

            e.preventDefault()
            e.stopPropagation()

            const currentTokens = filteredTokens
            if (!currentTokens.length) return

            switch (e.key) {
                case "ArrowDown":
                case "ArrowUp":
                    const newIndex =
                        e.key === "ArrowDown"
                            ? (selectedIndex + 1) % currentTokens.length
                            : (selectedIndex - 1 + currentTokens.length) % currentTokens.length
                    setSelectedIndex(newIndex)
                    requestAnimationFrame(() => {
                        selectedItemRef.current?.scrollIntoView({block: "nearest"})
                    })
                    break

                case "Enter":
                    if (currentTokens[selectedIndex]) {
                        selectOption(currentTokens[selectedIndex])
                    }
                    break

                case "Escape":
                    setAnchor(null)
                    break
            }
        }

        document.addEventListener("keydown", handleKeyDown, true)
        return () => document.removeEventListener("keydown", handleKeyDown, true)
    }, [anchor, filteredTokens, selectedIndex, selectOption])

    if (!anchor || !filteredTokens.length) return null

    return createPortal(
        <div
            ref={(node) => {
                containerRef.current = node
                refs.setFloating(node)
            }}
            className="bg-white border border-solid border-gray-100 rounded drop-shadow-xl max-h-[160px] w-[150px] overflow-y-auto outline-none"
            style={{
                ...floatingStyles,
                zIndex: 1050,
            }}
        >
            {filteredTokens.map((token, index) => (
                <div
                    key={token}
                    ref={index === selectedIndex ? selectedItemRef : null}
                    onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        selectOption(token!)
                    }}
                    className={`px-2 py-1.5 cursor-pointer font-mono text-[10px] truncate ${
                        index === selectedIndex ? "bg-blue-100 text-blue-800" : "hover:bg-gray-100"
                    }`}
                >
                    {token}
                </div>
            ))}
        </div>,
        document.body,
    )
}
