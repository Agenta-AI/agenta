import {useEffect, useCallback} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {useLexicalTextEntity} from "@lexical/react/useLexicalTextEntity"
import {TextNode, $createTextNode, LexicalNode, $isRangeSelection, $getSelection} from "lexical"

import {navigateCursor} from "./assets/selectionUtils"
import {TokenInputNode, $createTokenInputNode, $isTokenInputNode} from "./TokenInputNode"
import {TokenNode, $createTokenNode, $isTokenNode} from "./TokenNode"

type TemplateFormat = "curly" | "fstring" | "jinja2"

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
    // Default: curly variable tokens only
    const full = /\{\{[^{}]*\}\}/
    const input = /\{\{[^{}]*$/
    const exact = /^\{\{[^{}]*\}\}$/
    return {FULL_TOKEN_REGEX: full, TOKEN_INPUT_REGEX: input, EXACT_TOKEN_REGEX: exact}
}

export function TokenPlugin({templateFormat = "curly"}: {templateFormat?: TemplateFormat}): null {
    const [editor] = useLexicalComposerContext()
    const {FULL_TOKEN_REGEX, TOKEN_INPUT_REGEX, EXACT_TOKEN_REGEX} = buildRegexes(templateFormat)

    useEffect(() => {
        if (!editor.hasNodes([TokenNode, TokenInputNode])) {
            throw new Error("TokenPlugin: TokenNode or TokenInputNode not registered on editor")
        }

        const $transformNode = (textNode: LexicalNode | null | undefined) => {
            if (!textNode) return

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

                if (beforeToken) {
                    const beforeNode = $createTextNode(beforeToken)
                    textNode.insertBefore(beforeNode)
                }

                const tokenNode = $createTokenNode(fullMatch)
                textNode.insertBefore(tokenNode)

                if (afterToken) {
                    const afterNode = $createTextNode(afterToken)
                    textNode.insertBefore(afterNode)
                    if (fullMatch === "{{}}") {
                        navigateCursor({nodeKey: tokenNode.getKey(), offset: 2})
                    } else {
                        // Get the current selection before any transformations
                        const selection = $getSelection()
                        const cursorOffset = $isRangeSelection(selection)
                            ? selection.anchor.offset
                            : 0
                        // Calculate the new cursor position based on where it was before
                        const tokenStart = text.indexOf(fullMatch)
                        const tokenEnd = tokenStart + fullMatch.length

                        navigateCursor({
                            nodeKey: afterNode.getKey(),
                            offset: Math.max(0, cursorOffset - tokenEnd),
                        })
                    }
                } else if (fullMatch === "{{}}") {
                    navigateCursor({nodeKey: tokenNode.getKey(), offset: 2})
                } else {
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

        return () => {
            unregisterTextNodeTransform()
            unregisterTokenInputNodeTransform()
        }
    }, [editor, templateFormat])

    const getTokenMatch = useCallback(
        (text: string) => {
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
        [templateFormat],
    )

    const getTokenInputMatch = useCallback(
        (text: string) => {
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
        [templateFormat],
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
