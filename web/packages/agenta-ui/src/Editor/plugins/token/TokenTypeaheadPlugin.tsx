import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {KNOWN_ENVELOPE_SLOTS} from "@agenta/shared/utils"
import {autoUpdate, flip, offset, shift, useFloating} from "@floating-ui/react"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getNodeByKey, $getSelection, $isRangeSelection} from "lexical"
import {createPortal} from "react-dom"

import {navigateCursor} from "./assets/selectionUtils"
import {$isTokenNode} from "./TokenNode"
import {useTokenPathSuggestionsContext} from "./TokenPathSuggestionsContext"

// ============================================================================
// SUGGESTION MODEL
// ============================================================================

/**
 * Unified suggestion item. Covers both legacy "completed token name" mode
 * and path-aware mode (`$.<slot>.<root>.<...>`) so the render + keyboard
 * handlers don't have to branch.
 */
interface Suggestion {
    /** Displayed in the menu. */
    label: string
    /**
     * Full `{{...}}` text to set on the token when chosen. Pre-rendering
     * this at suggestion time keeps the selection handler stateless.
     */
    tokenText: string
    /**
     * Optional hint shown next to the label (e.g. "envelope slot").
     * Helps users understand why a suggestion exists.
     */
    hint?: string
}

interface PathContext {
    /** Path segments already committed before the current input (e.g. ["inputs"] when typing `$.inputs.ar`). */
    prefix: string[]
    /** Current (incomplete) segment the user is typing. */
    current: string
}

/**
 * Parse the inside of a `{{...}}` token to determine whether the user is
 * authoring a JSONPath expression and where within it they are. Returns
 * `null` for non-path inputs so the caller falls back to legacy mode.
 *
 * Examples:
 *   `$.`                   → {prefix: [],                  current: ""}
 *   `$.in`                 → {prefix: [],                  current: "in"}
 *   `$.inputs.`            → {prefix: ["inputs"],          current: ""}
 *   `$.inputs.arda.`       → {prefix: ["inputs", "arda"],  current: ""}
 *   `$.inputs.arda.test`   → {prefix: ["inputs", "arda"],  current: "test"}
 */
function parsePathContext(input: string): PathContext | null {
    if (!input.startsWith("$")) return null
    const body = input.replace(/^\$\.?/, "")
    if (body === "" && input === "$") return {prefix: [], current: ""}
    const endsOnBoundary = input.endsWith(".") || input.endsWith("[")
    const segments = body.split(/[.[\]'"]/).filter(Boolean)
    const prefix = endsOnBoundary ? segments : segments.slice(0, -1)
    const current = endsOnBoundary ? "" : (segments[segments.length - 1] ?? "")
    return {prefix, current}
}

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
        middleware: [offset(4), flip(), shift({padding: 8})],
        whileElementsMounted: autoUpdate,
    })

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

    const pathContext = useMemo(() => parsePathContext(inputQuery), [inputQuery])

    /**
     * Consumer-provided path suggestions (optional). The playground injects
     * this to surface port-schema sub-paths and observed testcase column
     * names. When mounted it's unioned with the plugin's baseline sources.
     *
     * The context also carries optional `allowedEnvelopeSlots` — when
     * set, the depth-0 envelope suggestion list is restricted to this
     * subset (e.g. playground hides `$.trace` / `$.revision` until the
     * sources for those are wired).
     */
    const pathContextValue = useTokenPathSuggestionsContext()
    const getContextSuggestions = pathContextValue?.getSuggestions ?? null
    const allowedEnvelopeSlots = pathContextValue?.allowedEnvelopeSlots

    /**
     * Suggestions while authoring a JSONPath token.
     *
     * Sources (in precedence order, deduped by label):
     *  1. Envelope slots at depth 0 (always).
     *  2. Consumer-provided suggestions from the path-suggestions context
     *     (playground surfaces port schemas + observed keys here).
     *  3. Fallback: previously-seen tokens sharing the current path prefix.
     *
     * Trailing-dot rule: only envelope slots get `.` appended because
     * they're always containers. Everything else ends cleanly — the user
     * types `.` manually to continue drilling, or `}}` to close.
     */
    const pathSuggestions = useMemo<Suggestion[]>(() => {
        if (!pathContext) return []
        const {prefix, current} = pathContext
        const query = current.toLowerCase()
        const results: Suggestion[] = []
        const seen = new Set<string>()

        const push = (
            label: string,
            {hint, appendDot = false}: {hint?: string; appendDot?: boolean} = {},
        ) => {
            if (seen.has(label)) return
            if (query && !label.toLowerCase().startsWith(query)) return
            if (label === current) return
            seen.add(label)
            const body = [...prefix, label].join(".")
            results.push({
                label,
                tokenText: `{{$.${body}${appendDot ? "." : ""}}}`,
                hint,
            })
        }

        // 1. Envelope slots at the root. Consumer can narrow the list via
        //    `allowedEnvelopeSlots` on the context (e.g. playground only
        //    enables inputs/outputs today).
        if (prefix.length === 0) {
            const slots = allowedEnvelopeSlots ?? Array.from(KNOWN_ENVELOPE_SLOTS)
            for (const slot of slots) push(slot, {hint: "envelope", appendDot: true})
        }

        // 2. Consumer context (port schemas, observed keys — optional).
        if (getContextSuggestions) {
            const provided = getContextSuggestions(prefix, current)
            for (const s of provided) push(s.label, {hint: s.hint})
        }

        // 3. Mine previously-seen tokens under this prefix (deepest fallback).
        if (prefix.length > 0) {
            const pathPrefix = `$.${prefix.join(".")}.`
            for (const token of dynamicallyReadingTokens) {
                if (!token || !token.startsWith(pathPrefix)) continue
                const rest = token.slice(pathPrefix.length)
                const nextSeg = rest.split(/[.[\]'"]/).filter(Boolean)[0]
                if (!nextSeg) continue
                push(nextSeg, {hint: "seen"})
            }
        }

        return results
    }, [pathContext, getContextSuggestions, allowedEnvelopeSlots, dynamicallyReadingTokens])

    // Legacy suggestions: previously-seen whole tokens (non-path mode only).
    const legacySuggestions = useMemo<Suggestion[]>(() => {
        if (pathContext) return []
        const items = dynamicallyReadingTokens
            .filter((token): token is string => !!token)
            .filter((token) => {
                if (!inputQuery) return true
                return token.includes(inputQuery) && token !== inputQuery
            })
        return items.map((token) => ({label: token, tokenText: `{{${token}}}`}))
    }, [dynamicallyReadingTokens, inputQuery, pathContext])

    const suggestions = pathContext ? pathSuggestions : legacySuggestions

    const selectOption = useCallback(
        (suggestion: Suggestion) => {
            if (!anchor) return

            editor.update(() => {
                const node = $getNodeByKey(anchor.key)
                if ($isTokenNode(node)) {
                    node.setTextContent(suggestion.tokenText)
                    // Position cursor just before the closing `}}` so the user
                    // can keep typing (e.g. drill further into a path).
                    navigateCursor({
                        nodeKey: node.getKey(),
                        offset: suggestion.tokenText.length - 2,
                    })
                }
            })

            setAnchor(null)
            setSelectedIndex(0)
            setInputQuery("")
        },
        [anchor, editor],
    )

    // Track token node changes — unchanged from legacy behavior.
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
                    const match = text.match(/^\{\{(.*?)\}\}$/)
                    const offsetPos = selection.anchor.offset

                    if (match && offsetPos >= 2 && offsetPos <= text.length - 2) {
                        setInputQuery(match[1])
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

    // Reset highlight when suggestion list changes (e.g. user typed another char).
    useEffect(() => {
        setSelectedIndex(0)
    }, [suggestions])

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

    // Keyboard navigation
    useEffect(() => {
        if (!anchor) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(e.key)) return
            if (!suggestions.length && e.key !== "Escape") return

            e.preventDefault()
            e.stopPropagation()

            switch (e.key) {
                case "ArrowDown":
                case "ArrowUp": {
                    const newIndex =
                        e.key === "ArrowDown"
                            ? (selectedIndex + 1) % suggestions.length
                            : (selectedIndex - 1 + suggestions.length) % suggestions.length
                    setSelectedIndex(newIndex)
                    requestAnimationFrame(() => {
                        selectedItemRef.current?.scrollIntoView({block: "nearest"})
                    })
                    break
                }
                case "Enter":
                case "Tab":
                    if (suggestions[selectedIndex]) {
                        selectOption(suggestions[selectedIndex])
                    }
                    break
                case "Escape":
                    setAnchor(null)
                    break
            }
        }

        document.addEventListener("keydown", handleKeyDown, true)
        return () => document.removeEventListener("keydown", handleKeyDown, true)
    }, [anchor, suggestions, selectedIndex, selectOption])

    if (!anchor || !suggestions.length) return null

    return createPortal(
        <div
            ref={(node) => {
                containerRef.current = node
                refs.setFloating(node)
            }}
            className="bg-white border border-solid border-gray-100 rounded drop-shadow-xl max-h-[200px] w-[200px] overflow-y-auto outline-none"
            style={{
                ...floatingStyles,
                zIndex: 1050,
            }}
        >
            {suggestions.map((suggestion, index) => (
                <div
                    key={`${suggestion.label}::${index}`}
                    ref={index === selectedIndex ? selectedItemRef : null}
                    onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        selectOption(suggestion)
                    }}
                    className={`flex items-center justify-between gap-2 px-2 py-1.5 cursor-pointer font-mono text-[10px] ${
                        index === selectedIndex ? "bg-blue-100 text-blue-800" : "hover:bg-gray-100"
                    }`}
                >
                    <span className="truncate">{suggestion.label}</span>
                    {suggestion.hint ? (
                        <span className="text-[9px] uppercase tracking-wide text-gray-400 shrink-0">
                            {suggestion.hint}
                        </span>
                    ) : null}
                </div>
            ))}
        </div>,
        document.body,
    )
}
