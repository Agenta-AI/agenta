// plugins/SyntaxHighlightPlugin.tsx
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    $createRangeSelection,
    $setSelection,
    $isTabNode,
    $isTextNode,
    TextNode,
    NodeKey,
    $getNodeByKey,
    RangeSelection,
} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {
    $createCodeHighlightNode,
    $isCodeHighlightNode,
    CodeHighlightNode,
} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"
import {getDiffRange} from "../utils/getDiffRange"
import {isPluginLocked, lockPlugin, unlockPlugin} from "../utils/pluginLocks"
import {tokenizeCodeLine} from "../utils/tokenizer"

const PLUGIN_NAME = "SyntaxHighlightPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true})

/**
 * Updates a code line while preserving cursor position.
 *
 * This helper function allows modifying code line content (e.g. for syntax highlighting)
 * while keeping the cursor in the same relative position. This is crucial for maintaining
 * a smooth editing experience when syntax highlighting updates happen.
 *
 * The process:
 * 1. Calculates current cursor position relative to line start
 * 2. Executes the update function
 * 3. Recalculates and restores cursor position in the updated content
 *
 * @param lineKey - Key of the CodeLineNode to update
 * @param fn - Function that performs the actual update, returns true if content changed
 */
function $updateAndRetainSelection(
    lineKey: NodeKey,
    _selection: RangeSelection,
    fn: () => boolean,
): void {
    const lineNode = $getNodeByKey(lineKey)
    const node = lineNode || null
    if (!node || !$isCodeLineNode(node) || !node.isAttached()) return

    const selection = $getSelection()
    if (!$isRangeSelection(selection)) {
        fn()
        return
    }

    const anchor = selection.anchor
    const anchorNode = anchor.getNode()
    const offsetInAnchor = anchor.offset

    const totalOffset =
        offsetInAnchor +
        anchorNode.getPreviousSiblings().reduce((acc, n) => acc + n.getTextContentSize(), 0)

    const changed = fn()
    if (!changed) return

    let remainingOffset = totalOffset
    const children = node.getChildren()

    for (const child of children) {
        if (!$isTextNode(child)) continue
        const size = child.getTextContentSize()
        if (remainingOffset <= size) {
            const sel = $createRangeSelection()

            if (_selection.anchor.getNode().getTextContent() === child.getTextContent()) {
                sel.anchor.set(child.getKey(), _selection.anchor.offset, "text")
                sel.focus.set(child.getKey(), _selection.focus.offset, "text")
            } else {
                sel.anchor.set(child.getKey(), remainingOffset, "text")
                sel.focus.set(child.getKey(), remainingOffset, "text")
            }
            $setSelection(sel)
            break
        }
        remainingOffset -= size
    }
}

/**
 * Plugin that provides real-time syntax highlighting for code blocks.
 *
 * Key features:
 * - Language-aware syntax highlighting
 * - Real-time updates as you type
 * - Preserves cursor position during updates
 * - Optimizes updates by only changing modified tokens
 * - Handles both text and highlight node transformations
 *
 * The highlighting process:
 * 1. Detects changes in code lines
 * 2. Extracts text content
 * 3. Tokenizes based on language
 * 4. Updates highlight nodes
 * 5. Preserves tabs and cursor position
 *
 * Uses a locking mechanism to prevent concurrent updates
 * and maintains a smooth editing experience.
 */
export function SyntaxHighlightPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        /**
         * Transforms a code line by applying syntax highlighting.
         *
         * The transformation process:
         * 1. Gets the language from parent code block
         * 2. Extracts text content from line's children
         * 3. Tokenizes the text using language-specific rules
         * 4. Compares new tokens with existing ones to avoid unnecessary updates
         * 5. If needed, replaces highlight nodes while preserving tabs
         *
         * Uses a locking mechanism to prevent concurrent transformations
         * and maintains cursor position during updates.
         *
         * @param lineNode - The code line to transform
         */
        const $transformLine = (lineNode: CodeLineNode) => {
            const parent = lineNode.getParent()
            if (!$isCodeBlockNode(parent)) return
            if (isPluginLocked(PLUGIN_NAME)) {
                log("Skipped re-highlight (plugin locked)")
                return
            }

            const language = parent.getLanguage()
            const children = lineNode.getChildren()

            // Extract pure text content, ignoring tab nodes
            // This ensures we only tokenize actual code content
            const text = children
                .filter((child) => !$isTabNode(child))
                .map((child) => child.getTextContent())
                .join("")

            const tokens = tokenizeCodeLine(text, language)
            log("Tokens after tokenization", tokens)

            // Get existing highlight nodes and their token information
            const highlightChildren = children.filter($isCodeHighlightNode)
            const existingTokens = highlightChildren.map((n) => ({
                content: n.getTextContent(),
                type: n.getHighlightType(),
            }))

            // Check if new tokens match existing ones to avoid unnecessary updates
            // This optimization prevents re-rendering when content hasn't changed
            const tokenMatch =
                tokens.length === existingTokens.length &&
                tokens.every(
                    (t, i) =>
                        t.content === existingTokens[i]?.content &&
                        t.type === existingTokens[i]?.type,
                )
            if (tokenMatch) {
                log("Skipped re-highlight (tokens identical)")
                return
            }

            lockPlugin(PLUGIN_NAME)

            // Start a mutable editor transaction to update highlighting
            editor.update(
                () => {
                    $updateAndRetainSelection(lineNode.getKey(), $getSelection()?.clone(), () => {
                        // Separate tabs from highlight nodes
                        // Tabs need to be preserved in their positions
                        const current = lineNode.getChildren()
                        const tabs = current.filter($isTabNode)
                        const highlights = current.filter($isCodeHighlightNode)

                        // Create new highlight nodes from tokens
                        const newHighlights = tokens.map(({content, type}) =>
                            $createCodeHighlightNode(content, type, false, null),
                        )

                        // Calculate minimal set of changes needed
                        // This optimizes the update by only replacing changed nodes
                        const {from, to, nodesForReplacement} = getDiffRange(
                            highlights,
                            newHighlights,
                        )

                        if (from === to && nodesForReplacement.length === 0) {
                            return false
                        }

                        log("Highlight diff", {
                            from,
                            to,
                            nodesForReplacement,
                            begin: from + tabs.length,
                            end: to - from || 1,
                        })

                        lineNode.splice(from + tabs.length, to - from || 1, nodesForReplacement)
                        return true
                    })
                },
                {
                    // skipTransforms: true,
                    onUpdate: () => {
                        log("unlocking")
                        unlockPlugin(PLUGIN_NAME)
                    },
                },
            )
        }

        // Register transform for text nodes
        // This ensures syntax highlighting updates when text content changes
        const unregisterText = editor.registerNodeTransform(TextNode, (node) => {
            const parent = node.getParent()
            if ($isCodeLineNode(parent)) $transformLine(parent)
        })

        // Register transform for highlight nodes
        // This ensures consistent highlighting when nodes are modified
        const unregisterHighlight = editor.registerNodeTransform(CodeHighlightNode, (node) => {
            const parent = node.getParent()
            log("registerNodeTransform", node)
            if ($isCodeLineNode(parent)) $transformLine(parent)
        })

        return () => {
            unregisterText()
            unregisterHighlight()
        }
    }, [editor])

    return null
}
