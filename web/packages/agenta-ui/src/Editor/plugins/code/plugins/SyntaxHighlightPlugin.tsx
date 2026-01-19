// plugins/SyntaxHighlightPlugin.tsx
import {useEffect} from "react"

import {createLogger} from "@agenta/shared"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import Ajv, {ErrorObject} from "ajv"
import {
    $getSelection,
    $isRangeSelection,
    $createRangeSelection,
    $setSelection,
    $isTextNode,
    TextNode,
    NodeKey,
    $getNodeByKey,
    RangeSelection,
    COMMAND_PRIORITY_LOW,
    LexicalNode,
} from "lexical"

import {INITIAL_CONTENT_COMMAND} from "../../../commands/InitialContentCommand"
import {store, editorStateAtom} from "../index"
import {
    $createBase64Node,
    $isBase64Node,
    isBase64String,
    parseBase64String,
} from "../nodes/Base64Node"
import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {
    $createCodeHighlightNode,
    $isCodeHighlightNode,
    CodeHighlightNode,
} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {$isCodeTabNode} from "../nodes/CodeTabNode"
import {
    $createLongTextNode,
    $isLongTextNode,
    isLongTextString,
    parseLongTextString,
} from "../nodes/LongTextNode"
import {getDiffRange} from "../utils/getDiffRange"
import {isPluginLocked, lockPlugin, unlockPlugin} from "../utils/pluginLocks"
import {tokenizeCodeLine} from "../utils/tokenizer"

type ValidationError = ErrorObject<string, Record<string, any>, unknown>

// Editor-specific validation contexts - keyed by editor ID
const editorValidationContexts = new Map<
    string,
    {
        editorId?: string
        schema?: any
        ajv?: Ajv
        errorTexts?: Set<string>
        errorList?: ValidationError[]
    }
>()

// Current active editor ID for validation context
let currentEditorId: string | null = null

/**
 * Get the current editor ID used for validation context
 */
export function getCurrentEditorId(): string | null {
    return currentEditorId
}

/**
 * Set the current editor ID for validation context
 */
export function setCurrentEditorId(editorId: string) {
    currentEditorId = editorId
}

/**
 * Get validation context for a specific editor or the current editor
 */
export function getValidationContext(editorId?: string) {
    const targetEditorId = editorId || currentEditorId
    if (!targetEditorId) {
        return {}
    }
    return editorValidationContexts.get(targetEditorId) || {}
}

/**
 * Function to set validation context for a specific editor
 */
export function setValidationContext(
    editorId: string,
    context: {
        schema?: any
        ajv?: Ajv
        errorTexts?: Set<string>
        errorList?: ValidationError[]
    },
) {
    if (!editorId) {
        console.warn("⚠️ [SyntaxHighlightPlugin] No editor ID available for validation context")
        return
    }

    editorValidationContexts.set(editorId, context)
}

const PLUGIN_NAME = "SyntaxHighlightPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true})

/**
 * Runs validation on a code line after syntax highlighting is complete.
 * This function runs in the same Lexical transform as syntax highlighting,
 * ensuring validation errors are applied to nodes in a single update cycle.
 *
 * @param lineNode - The code line node that was just highlighted
 */

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
    _selection: RangeSelection | undefined,
    fn: () => boolean,
): void {
    const lineNode = $getNodeByKey(lineKey)
    const node = lineNode || null
    if (!node || !$isCodeLineNode(node) || !node.isAttached()) return

    const selection = $getSelection()
    if (!_selection || !$isRangeSelection(selection)) {
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
interface SyntaxHighlightPluginProps {
    editorId: string
    schema?: any
    debug?: boolean
    disableLongText?: boolean
}

export function SyntaxHighlightPlugin({
    editorId,
    schema,
    debug = false,
    disableLongText = false,
}: SyntaxHighlightPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        // Set this editor as the current one for validation context
        setCurrentEditorId(editorId)

        if (schema) {
            // Set schema for this specific editor
            setValidationContext(editorId, {
                schema,
                errorTexts: new Set(),
                errorList: [],
            })
        }
    }, [schema])

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
            const lineKey = lineNode.getKey()
            const textContent = lineNode.getTextContent()
            log(`🎨 [SyntaxHighlightPlugin] $transformLine called:`, {
                lineKey,
                textContent: textContent.substring(0, 50) + (textContent.length > 50 ? "..." : ""),
                textLength: textContent.length,
            })

            const parent = lineNode.getParent()
            log(`🔍 [SyntaxHighlightPlugin] Checking conditions:`, {
                lineKey,
                hasParent: !!parent,
                isCodeBlockParent: $isCodeBlockNode(parent),
                isPluginLocked: isPluginLocked(PLUGIN_NAME),
            })

            if (!$isCodeBlockNode(parent)) {
                log(
                    `⚠️ [SyntaxHighlightPlugin] Skipped line ${lineKey} - parent is not CodeBlockNode`,
                )
                return
            }
            if (isPluginLocked(PLUGIN_NAME)) {
                log(`🔒 [SyntaxHighlightPlugin] Skipped line ${lineKey} - plugin locked`)
                return
            }

            const language = parent.getLanguage()
            const children = lineNode.getChildren()
            log("🎨 [SyntaxHighlightPlugin] Transforming line", {
                language,
            })

            // Extract pure text content, ignoring tab nodes
            // This ensures we only tokenize actual code content
            const text = children
                .filter((child) => !$isCodeTabNode(child))
                .map((child) => child.getTextContent())
                .join("")

            const tokens = tokenizeCodeLine(text, language)
            log("🎨 [SyntaxHighlightPlugin] Tokens after tokenization", tokens)

            // Get existing highlight nodes and base64 nodes and their token information
            const highlightChildren = children.filter(
                (child): child is CodeHighlightNode =>
                    $isCodeHighlightNode(child) || $isBase64Node(child),
            )
            const existingTokens = highlightChildren.map((n) => ({
                content: n.getTextContent(),
                type: $isBase64Node(n) ? "base64" : n.getHighlightType(),
                hasValidationError: $isCodeHighlightNode(n) ? n.hasValidationError() : false,
                validationMessage: $isCodeHighlightNode(n) ? n.getValidationMessage() : null,
            }))

            // Check if new tokens match existing ones to avoid unnecessary updates
            // This optimization prevents re-rendering when content hasn't changed
            // Now includes validation state comparison to detect validation context changes
            // Also considers base64 tokens which may have different type representation
            const tokenMatch =
                tokens.length === existingTokens.length &&
                tokens.every((t, i) => {
                    const existing = existingTokens[i]
                    if (!existing) return false

                    // Check if both are base64 (existing is base64 node, new is string token with base64 content)
                    const newIsBase64 = t.type === "string" && isBase64String(t.content)
                    const existingIsBase64 = existing.type === "base64"
                    if (newIsBase64 && existingIsBase64) {
                        return t.content === existing.content
                    }

                    // Check if both are long text (existing is longtext node, new is string token with long text content)
                    const newIsLongText = t.type === "string" && isLongTextString(t.content)
                    const existingIsLongText = existing.type === "longtext"
                    if (newIsLongText && existingIsLongText) {
                        return t.content === existing.content
                    }

                    return t.content === existing.content && t.type === existing.type
                })
            log(`🔍 [SyntaxHighlightPlugin] Token comparison:`, {
                lineKey,
                tokenMatch,
                newTokensLength: tokens.length,
                existingTokensLength: existingTokens.length,
                newTokens: tokens.map((t) => `${t.type}:${t.content}`).slice(0, 3),
                existingTokens: existingTokens.map((t) => `${t.type}:${t.content}`).slice(0, 3),
            })

            // Validation will run inside the editor.update() transaction below
            // to maintain proper undo/redo history

            if (tokenMatch) {
                log(
                    `⏭️ [SyntaxHighlightPlugin] Tokens identical, skipping re-highlight but validation will run - line ${lineKey}`,
                )
                // Don't return early - let validation run in the main transform below
                // This ensures validation runs even when tokens are identical
            }

            lockPlugin(PLUGIN_NAME)

            log("transforming line", lineNode)
            editor.update(
                () => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return
                    $updateAndRetainSelection(lineNode.getKey(), selection.clone(), () => {
                        // Separate tabs from highlight/base64 nodes
                        // Tabs need to be preserved in their positions
                        const current = lineNode.getChildren()
                        const tabs = current.filter($isCodeTabNode)
                        const highlights = current.filter(
                            (child) =>
                                $isCodeHighlightNode(child) ||
                                $isBase64Node(child) ||
                                $isLongTextNode(child),
                        )

                        // Create new highlight nodes from tokens (pure syntax highlighting)
                        // Check for base64 strings and long text strings and create special nodes for them
                        const newHighlights: LexicalNode[] = tokens.map(({content, type}) => {
                            // Check if this is a base64 string token - create Base64Node for collapsed display
                            if (type === "string" && isBase64String(content)) {
                                const parsed = parseBase64String(content)
                                return $createBase64Node(parsed.fullValue, parsed.mimeType, type)
                            }

                            // Check if this is a long text string - create LongTextNode for truncated display
                            // Skip if disableLongText is true
                            // ALSO skip if user is currently typing in this text (has active selection in this line)
                            if (
                                type === "string" &&
                                !disableLongText &&
                                isLongTextString(content)
                            ) {
                                // Check if the current selection is within this line
                                // If user is actively typing, keep as regular text node for better UX
                                const currentSelection = $getSelection()
                                const isUserTypingInLine =
                                    $isRangeSelection(currentSelection) &&
                                    currentSelection.anchor.getNode().getParent() === lineNode

                                // Only convert to LongTextNode if user is NOT actively typing in this line
                                if (!isUserTypingInLine) {
                                    const parsed = parseLongTextString(content)
                                    return $createLongTextNode(parsed.fullValue, type)
                                }
                                // Otherwise fall through to create regular CodeHighlightNode
                            }

                            const node = $createCodeHighlightNode(
                                content,
                                type,
                                false, // No token-level validation
                                "", // No validation message
                            )

                            return node
                        })

                        // Always run validation first, regardless of highlighting changes

                        // Skip highlighting updates if tokens are identical
                        if (tokenMatch) {
                            log(
                                `✅ [SyntaxHighlightPlugin] Validation completed, skipping highlight update for line ${lineKey}`,
                            )
                            return false
                        }

                        // Calculate minimal set of changes needed for highlighting
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
            const nodeText = node.getTextContent()
            log(`🔤 [SyntaxHighlightPlugin] TextNode transform triggered:`, {
                nodeKey: node.getKey(),
                nodeText: nodeText.substring(0, 30) + (nodeText.length > 30 ? "..." : ""),
                textLength: nodeText.length,
                parentType: parent?.getType(),
                isCodeLineParent: $isCodeLineNode(parent),
            })

            if ($isCodeLineNode(parent)) {
                // check if there's a tab node right after this node
                const nextSibling = node.getNextSibling()
                if ($isCodeTabNode(nextSibling)) {
                    const allTrailingTabs = node.getNextSiblings().filter($isCodeTabNode)
                    const allTrailingTabsContent = allTrailingTabs.map((tab) =>
                        tab.getTextContent(),
                    )
                    const newNode = $createCodeHighlightNode(
                        nodeText + allTrailingTabsContent.join(""),
                        "text",
                        false,
                        "",
                    )
                    node.replace(newNode)
                    allTrailingTabs.forEach((tab) => tab.remove())
                }
                $transformLine(parent)
            }
        })

        // Register transform for highlight nodes
        // This ensures consistent highlighting when nodes are modified
        const unregisterHighlight = editor.registerNodeTransform(CodeHighlightNode, (node) => {
            const parent = node.getParent()
            log("🎨 CodeHighlightNode transform triggered", {
                nodeText: node.getTextContent(),
                nodeType: node.getHighlightType(),
                parentType: parent?.getType(),
                hasParent: !!parent,
            })

            if ($isCodeLineNode(parent)) {
                $transformLine(parent)
            }
        })

        // Note: Removed forced re-analysis event system to prevent editor corruption

        // Register mutation listener for bracket detection
        // This catches node deletions that transforms miss
        const unregisterMutationListener = editor.registerMutationListener(
            CodeHighlightNode,
            (mutatedNodes, {updateTags}) => {
                log("🔬 CodeHighlightNode mutation detected", {
                    mutationCount: mutatedNodes.size,
                    updateTags: Array.from(updateTags),
                })

                // Skip validation during undo/redo operations to preserve history
                if (
                    updateTags.has("history-merge") ||
                    updateTags.has("history-push") ||
                    updateTags.size > 0
                ) {
                    log("⏭️ Skipping validation during history operation")
                    return
                }

                // Check if any bracket-related nodes were mutated
                let _shouldAnalyzeBrackets = false
                for (const [nodeKey, mutation] of mutatedNodes) {
                    log(`  → Node ${nodeKey}: ${mutation}`)

                    // If a node was destroyed, we need to re-analyze brackets
                    if (mutation === "destroyed") {
                        _shouldAnalyzeBrackets = true
                        log("🚨 Node destroyed - triggering bracket re-analysis")
                    }
                }

                // Trigger bracket analysis if needed - CONSERVATIVE approach
                // if (shouldAnalyzeBrackets) {
                //     log("🔄 Scheduling conservative bracket re-analysis")
                //     // Just run validation directly - no need for full transform cycle
                //     editor.update(() => {
                //         // Find any code line and run validation only
                //         const root = $getRoot()
                //         const descendants = root.getAllTextNodes()
                //         for (const textNode of descendants) {
                //             const parent = textNode.getParent()
                //             if ($isCodeLineNode(parent)) {
                //                 // Run validation directly - this will refresh bracket detection

                //                 return // Only validate one line to refresh cache
                //             }
                //         }
                //     })
                // }
            },
            {skipInitialization: true}, // Don't trigger on initial load
        )

        // Listen for initial content command to run validation on initial load
        const unregisterInitialContent = editor.registerCommand(
            INITIAL_CONTENT_COMMAND,
            (payload) => {
                // Only run validation if this is truly initial content loading
                // Skip if the editor is focused (user is actively typing)
                const editorState = store.get(editorStateAtom)
                if (editorState?.focused) {
                    log(
                        `⏭️ [SyntaxHighlightPlugin] Skipping initial validation - editor is focused (user typing)`,
                    )
                    return false
                }

                log(`🚀 [SyntaxHighlightPlugin] Initial content loaded, running validation`)

                return false // Don't prevent other handlers
            },
            COMMAND_PRIORITY_LOW,
        )

        // Note: We don't need to listen to validation errors changes here
        // The validation errors will be applied during the normal highlighting process

        return () => {
            unregisterText()
            unregisterHighlight()
            unregisterMutationListener()
            unregisterInitialContent()
        }
    }, [editor])

    return null
}
