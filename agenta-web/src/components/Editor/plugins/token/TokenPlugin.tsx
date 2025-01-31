import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {TextNode, $createTextNode, LexicalNode, $isRangeSelection} from "lexical"
import {useEffect, useCallback} from "react"
import {TokenNode, $createTokenNode, $isTokenNode} from "./TokenNode"
import {TokenInputNode, $createTokenInputNode, $isTokenInputNode} from "./TokenInputNode"
import {useLexicalTextEntity} from "@lexical/react/useLexicalTextEntity"

const FULL_TOKEN_REGEX = /\{\{[^{}]+\}\}/
const TOKEN_INPUT_REGEX = /\{\{[^{}]*\}?$/

export function TokenPlugin(): null {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        if (!editor.hasNodes([TokenNode, TokenInputNode])) {
            throw new Error("TokenPlugin: TokenNode or TokenInputNode not registered on editor")
        }

        const transformNode = (textNode: LexicalNode | null | undefined) => {
            if (!textNode) return

            const text = textNode?.getTextContent()

            if ($isTokenNode(textNode)) {
                // Handle existing token nodes
                if (!text?.match(/^\{\{[^{}]+\}\}$/)) {
                    const parent = textNode.getParent()
                    if (!parent) return

                    const newTextNode = $createTextNode(text)
                    textNode.replace(newTextNode)
                }
                return
            }

            if ($isTokenInputNode(textNode)) {
                // Handle existing token input nodes
                if (text?.match(/^\{\{[^{}]+\}\}$/)) {
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
            const tokenInputMatch = text?.match(TOKEN_INPUT_REGEX)

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
            } else if (tokenInputMatch) {
                const [fullMatch] = tokenInputMatch
                const startOffset = tokenInputMatch.index!

                // Split text into parts
                const beforeToken = text.slice(0, startOffset)
                const afterToken = text.slice(startOffset + fullMatch.length)

                // Create nodes
                const parent = textNode.getParent()
                if (!parent) return

                if (beforeToken) {
                    const beforeNode = $createTextNode(beforeToken)
                    textNode.insertBefore(beforeNode)
                }

                const tokenInputNode = $createTokenInputNode(fullMatch)
                textNode.insertBefore(tokenInputNode)

                if (afterToken) {
                    const afterNode = $createTextNode(afterToken)
                    tokenInputNode.insertAfter(afterNode)
                }

                textNode.remove()
            } else if (text.match(/^\{\{[^{}]*\}?$/)) {
                const tokenInputNode = $createTokenInputNode(text)
                textNode.replace(tokenInputNode)
            }
        }

        const unregisterTextNodeTransform = editor.registerNodeTransform(TextNode, transformNode)
        const unregisterTokenInputNodeTransform = editor.registerNodeTransform(
            TokenInputNode,
            transformNode,
        )

        return () => {
            unregisterTextNodeTransform()
            unregisterTokenInputNodeTransform()
        }
    }, [editor])

    const getTokenMatch = useCallback((text: string) => {
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
    }, [])

    const getTokenInputMatch = useCallback((text: string) => {
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
    }, [])

    const createTokenNode = useCallback((textNode: TextNode) => {
        return $createTokenNode(textNode.getTextContent())
    }, [])

    const createTokenInputNode = useCallback((textNode: TextNode) => {
        return $createTokenInputNode(textNode.getTextContent())
    }, [])

    useLexicalTextEntity<TokenNode>(getTokenMatch, TokenNode, createTokenNode)
    useLexicalTextEntity<TokenInputNode>(getTokenInputMatch, TokenInputNode, createTokenInputNode)

    return null
}
