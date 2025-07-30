// plugins/SyntaxHighlightPlugin.tsx
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import Ajv, {ErrorObject} from "ajv"
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
    $getRoot,
    COMMAND_PRIORITY_LOW,
} from "lexical"

import {INITIAL_CONTENT_COMMAND} from "../../../commands/InitialContentCommand"
import {store, editorStateAtom} from "../index"
import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {
    $createCodeHighlightNode,
    $isCodeHighlightNode,
    CodeHighlightNode,
} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"
import {getEnhancedValidationContext} from "../utils/enhancedValidationContext"
import {getDiffRange} from "../utils/getDiffRange"
import {isPluginLocked, lockPlugin, unlockPlugin} from "../utils/pluginLocks"
import {tokenizeCodeLine} from "../utils/tokenizer"
import {validateAll} from "../utils/validationUtils"

type ValidationError = ErrorObject<string, Record<string, any>, unknown>

// Global validation state - will be set by RealTimeValidationPlugin
let globalValidationContext: {
    schema?: any
    ajv?: Ajv
    errorTexts?: Set<string>
    errorList?: ValidationError[]
} = {}

/**
 * Get the current global validation context
 */
export function getValidationContext() {
    return globalValidationContext
}

/**
 * Function to set validation context from RealTimeValidationPlugin
 */
export function setValidationContext(context: typeof globalValidationContext) {
    log("🔄 setValidationContext called", {
        oldErrorTextsSize: globalValidationContext.errorTexts?.size ?? 0,
        newErrorTextsSize: context.errorTexts?.size ?? 0,
        oldErrorListLength: globalValidationContext.errorList?.length ?? 0,
        newErrorListLength: context.errorList?.length ?? 0,
        newErrorTextsArray: context.errorTexts ? Array.from(context.errorTexts) : [],
    })
    globalValidationContext = context
}

/**
 * Check if unquoted text is likely a property name based on context
 */
function checkIfLikelyPropertyName(text: string, lineNode: CodeLineNode): boolean {
    // Get the line text to analyze context
    const lineText = lineNode.getTextContent()
    const textIndex = lineText.indexOf(text)

    if (textIndex === -1) return false

    // Check if there's a colon after this text (indicating property name)
    const afterText = lineText.substring(textIndex + text.length).trim()
    if (afterText.startsWith(":")) {
        return true
    }

    // Check if this text appears at the beginning of the line (more likely property name)
    const beforeText = lineText.substring(0, textIndex).trim()
    if (beforeText === "" || beforeText.endsWith("{") || beforeText.endsWith(",")) {
        // If there's a colon somewhere after this text on the same line
        if (afterText.includes(":")) {
            return true
        }
    }

    return false
}

/**
 * Get validation state for a specific token during syntax highlighting
 */
function getValidationForToken(
    text: string,
    highlightType: string,
    language: string,
    lineNode?: CodeLineNode,
): {shouldHaveError: boolean; expectedMessage: string | null} {
    // Skip validation for certain token types (check first)
    const isPunctuation = highlightType === "punctuation"
    const isOperator = highlightType === "operator"

    // Skip punctuation and operators entirely
    if (isPunctuation || isOperator) {
        return {shouldHaveError: false, expectedMessage: null}
    }

    // JSON syntax validation for unquoted text (independent of schema validation)
    if (language === "json" && highlightType === "plain") {
        // Check if this looks like unquoted text that should be quoted
        if (
            text !== "" &&
            isNaN(Number(text)) &&
            text !== "true" &&
            text !== "false" &&
            text !== "null"
        ) {
            // Try to determine context: is this a property name or a value?
            // This is a heuristic - we need to check the surrounding context
            const isLikelyPropertyName = lineNode
                ? checkIfLikelyPropertyName(text, lineNode)
                : false

            const errorMessage = isLikelyPropertyName
                ? "Property names must be wrapped in double quotes"
                : "String values must be wrapped in double quotes"

            // Add to enhanced validation context for consistency
            // Use a context-specific token key to avoid conflicts between quoted/unquoted versions
            const enhancedContext = getEnhancedValidationContext()
            enhancedContext.addError({
                token: `unquoted:${text}`, // Prefix to distinguish from quoted versions
                message: errorMessage,
                level: "syntax",
                type: "unquoted_property",
                severity: "error",
                timestamp: Date.now(),
                line: 0, // Will be updated by the calling context
            })

            return {
                shouldHaveError: true,
                expectedMessage: errorMessage,
            }
        }
    }

    // Try enhanced validation context
    const enhancedContext = getEnhancedValidationContext()
    const primaryError = enhancedContext.getPrimaryErrorForToken(text)

    if (primaryError) {
        return {
            shouldHaveError: true,
            expectedMessage: primaryError.message,
        }
    }

    // Fall back to legacy validation context
    const {errorTexts, errorList} = globalValidationContext

    // If no validation context is available, skip schema validation but allow syntax highlighting
    if (!errorTexts || !errorList) {
        return {shouldHaveError: false, expectedMessage: null}
    }

    // If validation context exists but no errors, skip schema validation
    if (errorTexts.size === 0) {
        return {shouldHaveError: false, expectedMessage: null}
    }

    // Schema validation for tokens that should be validated
    if (text !== "" && !Number(text) && text !== "true" && text !== "false" && text !== "null") {
        let shouldHaveError = errorTexts.has(text)
        let expectedMessage: string | null = null

        if (shouldHaveError) {
            // Find the actual error message that matches this text
            const matchingError = errorList.find((e) => e.message?.includes(text))

            if (matchingError) {
                expectedMessage = matchingError.message ?? "Invalid"
            } else {
                // If errorTexts has the text but errorList doesn't have a matching error,
                // the validation context is stale - don't show error
                shouldHaveError = false
                expectedMessage = null
            }
        }

        // Also check for quoted version
        if (!shouldHaveError && text.startsWith('"') && text.endsWith('"')) {
            const unquoted = text.slice(1, -1)
            const hasUnquotedError = errorTexts.has(unquoted)

            if (hasUnquotedError) {
                const matchingError = errorList.find((e) => e.message?.includes(unquoted))

                if (matchingError) {
                    // Special case: Don't highlight property names for "missing property" errors
                    // when the text is a quoted string (meaning the property is actually present)
                    const isQuotedPropertyName = text.startsWith('"') && text.endsWith('"')
                    const isMissingPropertyError =
                        matchingError.keyword === "required" &&
                        matchingError.message?.includes("must have required property")

                    if (isQuotedPropertyName && isMissingPropertyError) {
                        // Don't highlight - the property is present, just the validation context is stale
                    } else {
                        shouldHaveError = true
                        expectedMessage = matchingError.message ?? "Invalid"
                    }
                } else {
                    // Same stale context check for unquoted version - don't highlight
                }
            }
        }

        return {shouldHaveError, expectedMessage}
    }

    log("⏭️ Skipped validation (punctuation/operator/special)", {text, highlightType})
    return {shouldHaveError: false, expectedMessage: null}
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
// Track last validation to avoid redundant calls
let lastValidationContent = ""
let lastValidationTime = 0
const VALIDATION_DEBOUNCE_MS = 100

function $runValidationAfterHighlighting(lineNode: CodeLineNode, editor: any) {
    const lineKey = lineNode.getKey()

    if (!editor.isEditable()) {
        log(`⏭️ [SyntaxHighlightPlugin] Skipped validation - editor not editable (line ${lineKey})`)
        return
    }

    // Get the full editor content for validation
    const codeBlockNode = lineNode.getParent()

    if (!$isCodeBlockNode(codeBlockNode)) {
        return
    }

    const textContent = codeBlockNode.getTextContent()
    const now = Date.now()

    // Skip validation if content hasn't changed and it's within debounce period
    if (
        textContent === lastValidationContent &&
        now - lastValidationTime < VALIDATION_DEBOUNCE_MS
    ) {
        log(`⏭️ [SyntaxHighlightPlugin] Skipped validation - content unchanged (line ${lineKey})`)
        return
    }

    // Skip validation for very short content (likely initial load)
    if (textContent.length < 3) {
        log(`⏭️ [SyntaxHighlightPlugin] Skipped validation - content too short (line ${lineKey})`)
        return
    }

    log(`🔍 [SyntaxHighlightPlugin] Running validation after highlighting for line node ${lineKey}`)

    lastValidationContent = textContent
    lastValidationTime = now

    // Clean the text content by removing empty lines for validation
    // This prevents JSON5 line number mismatches and improves validation accuracy
    const originalLines = textContent.split("\n")
    const cleanedLines: string[] = []
    const cleanedToOriginalLineMap = new Map<number, number>()

    originalLines.forEach((line, originalIndex) => {
        if (line.trim() !== "") {
            cleanedLines.push(line)
            const cleanedLineNumber = cleanedLines.length
            const originalLineNumber = originalIndex + 1
            cleanedToOriginalLineMap.set(cleanedLineNumber, originalLineNumber)
        }
    })

    const cleanedTextContent = cleanedLines.join("\n")

    // Get the specific line that was just edited for active typing detection
    const editedLineNode = $getNodeByKey(lineKey)
    const editedLineContent = editedLineNode?.getTextContent()?.trim() || ""

    const validationResult = validateAll(
        cleanedTextContent,
        globalValidationContext.schema,
        editedLineContent,
        cleanedToOriginalLineMap,
    )

    // Debug schema errors specifically
    if (validationResult.schemaErrors.length > 0) {
        log(`🔍 [SyntaxHighlightPlugin] Schema errors detail:`, validationResult.schemaErrors)
    }

    // Create mapping from text content lines to visual lines (skipping empty lines)
    const textLines = textContent.split("\n")
    const visualLineMapping = new Map<number, number>()
    let visualLineNumber = 1

    textLines.forEach((textLine, textLineIndex) => {
        const textLineNumber = textLineIndex + 1
        if (textLine.trim() !== "") {
            visualLineMapping.set(textLineNumber, visualLineNumber)
            visualLineNumber++
        }
    })

    log(`🗺️ [SyntaxHighlightPlugin] Line mapping:`, {
        textLines: textLines.length,
        visualLines: visualLineNumber - 1,
        mapping: Array.from(visualLineMapping.entries()).slice(0, 10), // Show first 10 mappings
    })

    log(`🗺️ [SyntaxHighlightPlugin] Full line mapping details:`)
    textLines.forEach((textLine, textLineIndex) => {
        const textLineNumber = textLineIndex + 1
        const visualLine = visualLineMapping.get(textLineNumber)
        log(
            `  Text line ${textLineNumber}: "${textLine.trim()}" → Visual line ${visualLine || "SKIPPED"}`,
        )
    })

    // Group errors by VISUAL line number (not text content line number)
    const errorsByLine = new Map<number, typeof validationResult.allErrors>()

    validationResult.allErrors.forEach((error) => {
        // Map text content line number to visual line number
        const visualLine = visualLineMapping.get(error.line) || error.line
        const lineErrors = errorsByLine.get(visualLine) || []

        // Create a new error object with corrected line number
        const correctedError = {...error, line: visualLine}
        lineErrors.push(correctedError)
        errorsByLine.set(visualLine, lineErrors)

        log(
            `🔄 [SyntaxHighlightPlugin] Mapped error from text line ${error.line} to visual line ${visualLine}:`,
            error.message,
        )
    })

    // Apply validation errors to all code lines in the block
    const codeLines = codeBlockNode.getChildren().filter($isCodeLineNode)

    log(
        `🗺️ [SyntaxHighlightPlugin] ErrorsByLine map contents:`,
        Array.from(errorsByLine.entries()).map(
            ([line, errors]) => `Line ${line}: ${errors.length} errors`,
        ),
    )

    codeLines.forEach((line, index) => {
        const lineNumber = index + 1
        const lineErrors = errorsByLine.get(lineNumber) || []

        log(
            `🔍 [SyntaxHighlightPlugin] Checking visual line ${lineNumber}: found ${lineErrors.length} errors`,
        )

        // Set validation errors on the line node
        const writableLine = line.getWritable()
        writableLine.setValidationErrors(lineErrors)

        log(
            `🔴 Applied ${lineErrors.length} validation errors to line ${lineNumber}:`,
            lineErrors.map((e) => `[${e.type}] ${e.message}`),
        )
    })

    // Store validation results directly in editor state for GlobalErrorIndicatorPlugin
    if (editor) {
        // Store mapped validation errors in editor state (with corrected visual line numbers)
        const mappedStructuralErrors = validationResult.structuralErrors.map((error) => {
            const visualLine = visualLineMapping.get(error.line) || error.line
            return {...error, line: visualLine}
        })
        const mappedBracketErrors = validationResult.bracketErrors.map((error) => {
            const visualLine = visualLineMapping.get(error.line) || error.line
            return {...error, line: visualLine}
        })
        const mappedSchemaErrors = validationResult.schemaErrors.map((error) => {
            const visualLine = visualLineMapping.get(error.line) || error.line
            return {...error, line: visualLine}
        })

        ;(editor as any)._structuralErrors = mappedStructuralErrors
        ;(editor as any)._bracketErrors = mappedBracketErrors
        ;(editor as any)._schemaErrors = mappedSchemaErrors

        log(`📊 [SyntaxHighlightPlugin] Stored validation results in editor state:`, {
            structural: mappedStructuralErrors.length,
            bracket: mappedBracketErrors.length,
            schema: mappedSchemaErrors.length,
            totalErrors:
                mappedStructuralErrors.length +
                mappedBracketErrors.length +
                mappedSchemaErrors.length,
        })
    }
}

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
    schema?: any
    debug?: boolean
}

export function SyntaxHighlightPlugin({schema, debug = false}: SyntaxHighlightPluginProps = {}) {
    const [editor] = useLexicalComposerContext()

    // Update global validation context with schema
    useEffect(() => {
        if (schema) {
            globalValidationContext.schema = schema
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
                .filter((child) => !$isTabNode(child))
                .map((child) => child.getTextContent())
                .join("")

            const tokens = tokenizeCodeLine(text, language)
            log("🎨 [SyntaxHighlightPlugin] Tokens after tokenization", tokens)

            // Get existing highlight nodes and their token information
            const highlightChildren = children.filter($isCodeHighlightNode)
            const existingTokens = highlightChildren.map((n) => ({
                content: n.getTextContent(),
                type: n.getHighlightType(),
                hasValidationError: n.hasValidationError(),
                validationMessage: n.getValidationMessage(),
            }))

            // Check if new tokens match existing ones to avoid unnecessary updates
            // This optimization prevents re-rendering when content hasn't changed
            // Now includes validation state comparison to detect validation context changes
            const tokenMatch =
                tokens.length === existingTokens.length &&
                tokens.every((t, i) => {
                    const existing = existingTokens[i]
                    if (!existing) return false

                    // Get validation for this token based on current context
                    const {shouldHaveError, expectedMessage} = getValidationForToken(
                        t.content.trim(),
                        t.type,
                        language,
                        lineNode,
                    )

                    return (
                        t.content === existing.content &&
                        t.type === existing.type &&
                        shouldHaveError === existing.hasValidationError &&
                        expectedMessage === existing.validationMessage
                    )
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

            // Start a mutable editor transaction to update highlighting
            editor.update(
                () => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return
                    $updateAndRetainSelection(lineNode.getKey(), selection.clone(), () => {
                        // Separate tabs from highlight nodes
                        // Tabs need to be preserved in their positions
                        const current = lineNode.getChildren()
                        const tabs = current.filter($isTabNode)
                        const highlights = current.filter($isCodeHighlightNode)

                        // Create new highlight nodes from tokens with validation
                        const newHighlights = tokens.map(({content, type}) => {
                            // Apply validation logic during syntax highlighting
                            const {shouldHaveError, expectedMessage} = getValidationForToken(
                                content.trim(),
                                type,
                                language,
                                lineNode,
                            )

                            const node = $createCodeHighlightNode(
                                content,
                                type,
                                shouldHaveError,
                                expectedMessage,
                            )

                            // Log validation errors for debugging
                            if (shouldHaveError && content.trim()) {
                                log("✅ Syntax error detected", {
                                    token: content.trim(),
                                    type,
                                    message: expectedMessage,
                                })
                            }

                            return node
                        })

                        // Always run validation first, regardless of highlighting changes
                        $runValidationAfterHighlighting(lineNode, editor)

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
                let shouldAnalyzeBrackets = false
                for (const [nodeKey, mutation] of mutatedNodes) {
                    log(`  → Node ${nodeKey}: ${mutation}`)

                    // If a node was destroyed, we need to re-analyze brackets
                    if (mutation === "destroyed") {
                        shouldAnalyzeBrackets = true
                        log("🚨 Node destroyed - triggering bracket re-analysis")
                    }
                }

                // Trigger bracket analysis if needed - CONSERVATIVE approach
                if (shouldAnalyzeBrackets) {
                    log("🔄 Scheduling conservative bracket re-analysis")
                    // Just run validation directly - no need for full transform cycle
                    editor.update(() => {
                        // Find any code line and run validation only
                        const root = $getRoot()
                        const descendants = root.getAllTextNodes()
                        for (const textNode of descendants) {
                            const parent = textNode.getParent()
                            if ($isCodeLineNode(parent)) {
                                // Run validation directly - this will refresh bracket detection
                                $runValidationAfterHighlighting(parent, editor)
                                return // Only validate one line to refresh cache
                            }
                        }
                    })
                }
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

                // Schedule validation after initial content is processed
                setTimeout(() => {
                    editor.update(() => {
                        const root = $getRoot()
                        const codeBlock = root.getChildren().find($isCodeBlockNode)

                        if (codeBlock) {
                            const codeLines = codeBlock.getChildren().filter($isCodeLineNode)
                            if (codeLines.length > 0) {
                                // Run validation on the first line to trigger full validation
                                log(
                                    `🚀 [SyntaxHighlightPlugin] Running initial validation on ${codeLines.length} lines`,
                                )
                                $runValidationAfterHighlighting(codeLines[0], editor)
                            }
                        }
                    })
                }, 100) // Small delay to ensure content is fully processed

                return false // Don't prevent other handlers
            },
            COMMAND_PRIORITY_LOW,
        )

        return () => {
            unregisterText()
            unregisterHighlight()
            unregisterMutationListener()
            unregisterInitialContent()
        }
    }, [editor])

    return null
}
