import {useEffect, useCallback} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {useLexicalTextEntity} from "@lexical/react/useLexicalTextEntity"
import {
    TextNode,
    $createTextNode,
    $getRoot,
    LexicalNode,
    $isRangeSelection,
    $getSelection,
} from "lexical"

import {isEditorLargeDocument} from "../../utils/largeDocument"

import {navigateCursor} from "./assets/selectionUtils"
import {TokenInputNode, $createTokenInputNode, $isTokenInputNode} from "./TokenInputNode"
import {TokenNode, $createTokenNode, $isTokenNode} from "./TokenNode"

type TemplateFormat = "mustache" | "curly" | "fstring" | "jinja2"

function buildRegexes(templateFormat: TemplateFormat) {
    if (templateFormat === "jinja2") {
        // Match complete Jinja2 tokens: variables {{ }}, blocks {% %} (with optional - trim markers), comments {# #}
        const full = /(\{\{[\s\S]*?\}\}|\{%-?[\s\S]*?-?%\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\})/
        // Match incomplete tokens at end of string: starts of any of the three
        const input = /(\{\{[\s\S]*$|\{%-?[\s\S]*$|\{%[\s\S]*$|\{#[\s\S]*$)/
        // Exact match validator for token nodes (entire text content is one token)
        const exact = /^(\{\{[\s\S]*?\}\}|\{%-?[\s\S]*?-?%\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\})$/
        return {FULL_TOKEN_REGEX: full, TOKEN_INPUT_REGEX: input, EXACT_TOKEN_REGEX: exact}
    }
    if (templateFormat === "mustache") {
        // Match every well-formed Mustache tag as a token. Tag classes:
        //
        //   Name-bearing tags (also surfaced as variables by the discovery
        //   walker `extractTemplateVariables`):
        //     - Plain variables: `{{name}}`, `{{ name }}`, `{{country.a}}`,
        //       `{{$.country}}`.
        //     - `{{#items}}` — section opener (iterable / truthy).
        //     - `{{^empty}}` — inverted section opener.
        //     - `{{&html}}` — unescaped variable.
        //
        //   Structural / inert tags (tokenized for visual parity, but the
        //   discovery walker treats them as scope markers, comments, etc.
        //   — no port is emitted):
        //     - `{{/items}}` — section closer.
        //     - `{{! hidden note }}` — comment.
        //     - `{{> user_card}}` — partial.
        //     - `{{=<% %>=}}` — delimiter swap.
        //
        //   Rejected:
        //     - `{{{html}}}` — triple-stash. The `(?<!\{)` lookbehind avoids
        //       splitting the outer braces; users can write `{{&html}}` for
        //       the same semantics.
        //     - `{{.}}` / `{{ . }}` — implicit iterator. Rejected by the
        //       `(?!\.\s*\}\})` lookahead so we don't surface a phantom
        //       token named `.`. Other `.`-leading content (e.g. `{{.foo}}`
        //       — malformed) still tokenises so the bad input is visible.
        //     - Empty `{{}}` / `{{ }}` — rejected by the `(?=[^{}\s])` post-
        //       whitespace lookahead.
        //
        // History: JP's `17df11cca3` regex narrowed mustache to alphanumeric
        // tokens only, which killed `#`/`^`/`&` section-opener typeahead
        // (Mahmoud QA 2026-06-01). A follow-up re-admitted those three.
        // Phase 1 of `docs/designs/mustache-section-support.md` (2026-06-02)
        // extends this further: ALL well-formed tags tokenise — the
        // discovery walker handles the variable-vs-structural distinction,
        // not the editor regex. This gives Mahmoud's structural-tag
        // highlighting (`{{/repo}}` reads as a token, not plain text) without
        // affecting which variable cards show up.
        const full = /(?<!\{)\{\{\s*(?!\.\s*\}\})(?=[^{}\s])[^{}]*\}\}/
        const input = /(?<!\{)\{\{[^{}]*$/
        const exact = /^\{\{\s*(?!\.\s*\}\})(?=[^{}\s])[^{}]*\}\}$/
        return {FULL_TOKEN_REGEX: full, TOKEN_INPUT_REGEX: input, EXACT_TOKEN_REGEX: exact}
    }
    // Default: {{ }} variable tokens only. Covers "curly" and "mustache" —
    // fstring also falls through to here, but its {...} single-brace placeholders
    // are NOT matched by these {{ }} regexes.
    const full = /\{\{[^{}]*\}\}/
    const input = /\{\{[^{}]*$/
    const exact = /^\{\{[^{}]*\}\}$/
    return {FULL_TOKEN_REGEX: full, TOKEN_INPUT_REGEX: input, EXACT_TOKEN_REGEX: exact}
}

export function TokenPlugin({templateFormat = "curly"}: {templateFormat?: TemplateFormat}): null {
    const [editor] = useLexicalComposerContext()
    const {FULL_TOKEN_REGEX, TOKEN_INPUT_REGEX, EXACT_TOKEN_REGEX} = buildRegexes(templateFormat)
    const isLargeDocumentMode = useCallback(() => isEditorLargeDocument(editor), [editor])

    useEffect(() => {
        if (!editor.hasNodes([TokenNode, TokenInputNode])) {
            throw new Error("TokenPlugin: TokenNode or TokenInputNode not registered on editor")
        }

        const $transformNode = (textNode: LexicalNode | null | undefined) => {
            if (!textNode) return
            if (isLargeDocumentMode()) return

            const text = textNode?.getTextContent()

            if ($isTokenNode(textNode)) {
                // Handle existing token nodes
                if (!text || !EXACT_TOKEN_REGEX.test(text)) {
                    const parent = textNode.getParent()
                    if (!parent) return

                    const newTextNode = $createTextNode(text)
                    textNode.replace(newTextNode)
                }
                return
            }

            if ($isTokenInputNode(textNode)) {
                // Handle existing token input nodes
                if (text && EXACT_TOKEN_REGEX.test(text)) {
                    const tokenNode = $createTokenNode(text)
                    textNode.replace(tokenNode)
                    const spaceNode = $createTextNode(" ")
                    tokenNode.insertAfter(spaceNode)
                    editor.update(() => {
                        const selection = editor.getEditorState().read(() => {
                            const state = editor.getEditorState()
                            return state._selection
                        })
                        if ($isRangeSelection(selection)) {
                            spaceNode.selectEnd()
                        }
                    })
                }
                return
            }

            // Handle potential new tokens
            const tokenMatch = text?.match(FULL_TOKEN_REGEX)

            if (tokenMatch) {
                const [fullMatch] = tokenMatch
                const startOffset = tokenMatch.index!
                const endOffset = startOffset + fullMatch.length

                // Split text into parts
                const beforeToken = text?.slice(0, startOffset)
                const afterToken = text?.slice(endOffset)

                // Create nodes
                const parent = textNode?.getParent()
                if (!parent) return

                // Capture the cursor position BEFORE we create any new
                // nodes — it tells us where to put the caret after the
                // transform. The key distinction:
                //
                //   - Cursor INSIDE the matched braces (strictly between
                //     `{{` and `}}`): the user is typing inside an
                //     auto-closed token. `AutoCloseTokenBracesPlugin`
                //     turns `{{` into `{{|}}` with the cursor between
                //     the brace pairs, and the very next character the
                //     user types triggers this transform — keep the
                //     cursor inside the new TokenNode so they can keep
                //     typing the variable name.
                //
                //   - Cursor AT THE CLOSING EDGE (just typed `}}` to
                //     close manually): the user has finished authoring
                //     the token and is ready to type after it. The
                //     legacy behaviour kicks in — insert a space after
                //     the token and move the cursor past it.
                //
                // Without this check, every transform jumped the cursor
                // out of the token, which made auto-close + type-one-
                // letter feel like "the variable closes after my first
                // keystroke" (Mahmoud QA 2026-06-01, Kaosiso clarified
                // it as "cursor jumps outside the curly braces after
                // entering the first character").
                const preTransformSelection = $getSelection()
                const preTransformCursorOffset = $isRangeSelection(preTransformSelection)
                    ? preTransformSelection.anchor.offset
                    : -1
                const cursorInsideToken =
                    preTransformCursorOffset > startOffset + 1 &&
                    preTransformCursorOffset < endOffset - 1

                if (beforeToken) {
                    const beforeNode = $createTextNode(beforeToken)
                    textNode.insertBefore(beforeNode)
                }

                const tokenNode = $createTokenNode(fullMatch)
                textNode.insertBefore(tokenNode)

                let afterNode: TextNode | null = null
                if (afterToken) {
                    afterNode = $createTextNode(afterToken)
                    textNode.insertBefore(afterNode)
                }

                if (cursorInsideToken && fullMatch !== "{{}}") {
                    // Auto-close case — keep cursor inside the new
                    // TokenNode at the same relative offset as before.
                    navigateCursor({
                        nodeKey: tokenNode.getKey(),
                        offset: preTransformCursorOffset - startOffset,
                    })
                } else if (afterNode) {
                    if (fullMatch === "{{}}") {
                        navigateCursor({nodeKey: tokenNode.getKey(), offset: 2})
                    } else {
                        // Calculate cursor position relative to the
                        // after-text — preserves where the user was
                        // typing past the closed token.
                        navigateCursor({
                            nodeKey: afterNode.getKey(),
                            offset: Math.max(0, preTransformCursorOffset - endOffset),
                        })
                    }
                } else if (fullMatch === "{{}}") {
                    navigateCursor({nodeKey: tokenNode.getKey(), offset: 2})
                } else {
                    // Manual close, no trailing text — insert a space
                    // after the token so the user has somewhere to keep
                    // typing, and move the cursor to it.
                    const spaceNode = $createTextNode(" ")
                    tokenNode.insertAfter(spaceNode)
                    editor.update(() => {
                        const selection = editor.getEditorState().read(() => {
                            const state = editor.getEditorState()
                            return state._selection
                        })
                        if ($isRangeSelection(selection)) {
                            spaceNode.selectEnd()
                        }
                    })
                }

                textNode.remove()
            }
        }

        const unregisterTextNodeTransform = editor.registerNodeTransform(TextNode, $transformNode)
        const unregisterTokenInputNodeTransform = editor.registerNodeTransform(
            TokenInputNode,
            $transformNode,
        )

        // Force re-evaluation of existing TextNodes that may have been created
        // by hydration before these transforms were registered. In production builds,
        // the hydration effect can fire before TokenPlugin mounts, so the transform
        // pipeline never sees the initial TextNodes. Marking them dirty ensures the
        // just-registered transforms process any pending {{...}} patterns.
        editor.update(() => {
            if (isLargeDocumentMode()) {
                return
            }

            const root = $getRoot()
            for (const textNode of root.getAllTextNodes()) {
                if (textNode.getType() === "text") {
                    textNode.markDirty()
                }
            }
        })

        return () => {
            unregisterTextNodeTransform()
            unregisterTokenInputNodeTransform()
        }
    }, [editor, isLargeDocumentMode, templateFormat])

    const getTokenMatch = useCallback(
        (text: string) => {
            if (isLargeDocumentMode()) {
                return null
            }

            const fullTokenMatch = FULL_TOKEN_REGEX.exec(text)

            if (fullTokenMatch) {
                const startOffset = fullTokenMatch.index
                const endOffset = startOffset + fullTokenMatch[0].length

                return {
                    end: endOffset,
                    start: startOffset,
                }
            }

            return null
        },
        [FULL_TOKEN_REGEX, isLargeDocumentMode],
    )

    const getTokenInputMatch = useCallback(
        (text: string) => {
            if (isLargeDocumentMode()) {
                return null
            }

            const matchArr = TOKEN_INPUT_REGEX.exec(text)

            if (matchArr) {
                const startOffset = matchArr.index
                const endOffset = startOffset + matchArr[0].length

                return {
                    end: endOffset,
                    start: startOffset,
                }
            }

            return null
        },
        [TOKEN_INPUT_REGEX, isLargeDocumentMode],
    )

    const $createTokenNode_ = useCallback((textNode: TextNode) => {
        return $createTokenNode(textNode.getTextContent())
    }, [])

    const $createTokenInputNode_ = useCallback((textNode: TextNode) => {
        return $createTokenInputNode(textNode.getTextContent())
    }, [])

    useLexicalTextEntity<TokenNode>(getTokenMatch, TokenNode, $createTokenNode_)
    useLexicalTextEntity<TokenInputNode>(getTokenInputMatch, TokenInputNode, $createTokenInputNode_)

    return null
}
