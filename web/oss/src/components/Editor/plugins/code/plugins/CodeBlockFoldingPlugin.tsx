/**
 * CodeBlockFoldingPlugin.tsx
 *
 * This plugin implements code folding functionality in the editor.
 * It allows users to collapse and expand code blocks based on indentation levels,
 * providing better code organization and readability.
 *
 * Features:
 * - Indentation-based code folding
 * - Visual indicators for foldable regions
 * - Maintains fold state during editing
 * - Updates line visibility and gutter display
 *
 * @module CodeBlockFoldingPlugin
 */
import {useCallback, useEffect, useRef} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getRoot} from "lexical"

import {$isCodeBlockNode, CodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

import {updateGutter} from "./CodeGutterPlugin"

const log = createLogger("CodeBlockFoldingPlugin", {
    disabled: true,
})

/**
 * Handles click events on fold/unfold toggles.
 * Manages the folding state of code blocks and updates the visibility
 * of nested lines based on indentation.
 *
 * @param editor - The Lexical editor instance
 * @param line - The CodeLineNode that was clicked
 */
function handleFoldClick(editor: any, line: CodeLineNode) {
    log("Starting fold operation", {
        lineKey: line.getKey(),
        lineContent: line.getTextContent(),
        currentState: line.isCollapsed(),
    })

    /**
     * Update folding state in editor:
     * 1. Toggle collapsed state of clicked line
     * 2. Update line's internal state
     * 3. Log state change for debugging
     */
    editor.update(() => {
        const isNowCollapsed = !line.isCollapsed()
        line.setCollapsed(isNowCollapsed)

        log("Set collapsed state", {
            isNowCollapsed,
            lineKey: line.getKey(),
        })

        /**
         * Prepare for nested line processing:
         * 1. Get base line's indentation level
         * 2. Find first nested line
         * 3. Use regex to extract leading whitespace
         */
        const text = line.getTextContent()
        const baseIndent = text.match(/^\s*/)?.[0].length || 0
        let currentLine = line.getNextSibling()

        log("Starting to process nested lines", {
            baseIndent,
            baseText: text,
            isNowCollapsed,
        })

        /**
         * Update visual fold indicator:
         * 1. Find line's DOM element
         * 2. Locate fold toggle button
         * 3. Update arrow direction based on state
         * - ▸ for collapsed (right arrow)
         * - ▾ for expanded (down arrow)
         */
        const lineDom = editor.getElementByKey(line.getKey())
        if (lineDom) {
            const btn = lineDom.querySelector(".fold-toggle")
            if (btn) {
                btn.textContent = isNowCollapsed ? "▸" : "▾"
            }
        }

        /**
         * Process nested lines:
         * 1. Track number of lines processed
         * 2. Check each line's indentation
         * 3. Stop at first line with same/less indent
         * 4. Log processing details for debugging
         */
        let processedLines = 0
        while (currentLine && $isCodeLineNode(currentLine)) {
            const content = currentLine.getTextContent()
            const currentIndent = content.match(/^\s*/)?.[0].length || 0

            log("Processing line", {
                lineKey: currentLine.getKey(),
                content,
                currentIndent,
                baseIndent,
            })

            // Break at end of nested block
            if (currentIndent <= baseIndent) {
                log("Found end of nested block", {
                    currentIndent,
                    baseIndent,
                })
                break
            }

            /**
             * Update line visibility:
             * 1. Set hidden state based on fold state
             * 2. Track number of processed lines
             * 3. Move to next sibling for processing
             */
            currentLine.setHidden(isNowCollapsed)
            processedLines++

            currentLine = currentLine.getNextSibling()
        }

        /**
         * Update gutter display:
         * 1. Get root and code block nodes
         * 2. Verify we have a valid code block
         * 3. Update gutter numbers to match visibility
         */
        const root = $getRoot()
        const codeBlock = root.getFirstChild()
        if ($isCodeBlockNode(codeBlock)) {
            log("Updating gutter")
            updateGutter(editor, codeBlock)
        }

        /**
         * Log operation completion:
         * 1. Track total lines processed
         * 2. Record final fold state
         * 3. Provide debug info for verification
         */
        log("Completed fold operation", {
            processedLines,
            finalState: isNowCollapsed,
        })
    })
}

/**
 * React component that implements code folding functionality.
 * Integrates with Lexical editor to provide code folding features and
 * manages the folding state of code blocks.
 *
 * Key features:
 * - Detects foldable regions based on indentation
 * - Updates fold indicators in real-time
 * - Maintains fold state during edits
 * - Synchronizes with gutter display
 *
 * @returns null - This is a behavior-only plugin
 */
export function CodeBlockFoldingPlugin() {
    /**
     * Plugin state initialization:
     * 1. Get editor context for mutations
     * 2. Track root element for event handling
     * 3. Store click handler for cleanup
     */
    const [editor] = useLexicalComposerContext()
    const rootElementRef = useRef<HTMLElement | null>(null)
    const clickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)

    /**
     * Click event handler setup:
     * 1. Memoize handler for performance
     * 2. Extract target element info
     * 3. Log click details for debugging
     * 4. Process fold toggle clicks
     */
    const handleClick = useCallback(
        (e: MouseEvent) => {
            const target = e.target as HTMLElement
            log("[Fold] Click target:", {
                className: target.className,
                tagName: target.tagName,
                textContent: target.textContent,
            })

            /**
             * Fold toggle click processing:
             * 1. Check if click was on fold button
             * 2. Find parent line element
             * 3. Log element search results
             * 4. Handle fold state changes
             */
            if (target.classList.contains("fold-toggle")) {
                log("[Fold] Fold button clicked")
                const lineElement = target.closest(".editor-code-line")
                log("[Fold] Looking for line element:", {
                    found: !!lineElement,
                    parentElement: target.parentElement?.className,
                })

                if (!lineElement) {
                    console.warn("[Fold] Could not find parent line element")
                    return
                }

                const key = lineElement.getAttribute("data-lexical-node-key")
                log("[Fold] Line element attributes:", {
                    key,
                    className: lineElement.className,
                    attributes: Array.from(lineElement.attributes).map(
                        (attr) => `${attr.name}=${attr.value}`,
                    ),
                })

                if (!key) {
                    console.warn("[Fold] Line element missing node key")
                    return
                }

                log("[Fold] Found line element", {
                    key,
                    content: lineElement.textContent,
                })

                editor.getEditorState().read(() => {
                    log("[Fold] Reading editor state")
                    const node = editor.getEditorState()._nodeMap.get(key)
                    log("[Fold] Found node:", {
                        exists: !!node,
                        type: node?.getType(),
                        isCodeLine: $isCodeLineNode(node),
                        key,
                    })

                    if ($isCodeLineNode(node)) {
                        handleFoldClick(editor, node)
                    } else {
                        console.warn("[Fold] Node is not a CodeLineNode", {
                            key,
                            nodeType: node?.getType(),
                        })
                    }
                })
            }
        },
        [editor],
    )

    // Setup and cleanup click handler
    useEffect(() => {
        const removeClickListener = editor.registerRootListener(
            (rootElement: null | HTMLElement) => {
                // Clean up old listener
                if (clickHandlerRef.current && rootElementRef.current) {
                    rootElementRef.current.removeEventListener("click", clickHandlerRef.current)
                }

                // Set up new listener
                if (rootElement) {
                    rootElementRef.current = rootElement
                    clickHandlerRef.current = handleClick
                    rootElement.addEventListener("click", handleClick)
                }
            },
        )

        // Set up folding state
        const removeMutationListener = editor.registerMutationListener(CodeBlockNode, () => {
            log("[Fold] Mutation detected")
            editor.update(() => {
                const root = $getRoot()
                const codeBlock = root.getFirstChild()
                if (!$isCodeBlockNode(codeBlock)) {
                    log("[Fold] No code block found")
                    return
                }

                const language = codeBlock.getLanguage()
                log("[Fold] Processing code block", {language})

                const codeLines = codeBlock.getChildren().filter($isCodeLineNode)
                log("[Fold] Found code lines", {count: codeLines.length})

                codeLines.forEach((line) => {
                    const text = line.getTextContent()
                    const shouldBeFoldable =
                        (language === "json" && text.trim().endsWith("{")) ||
                        (language === "yaml" && /:\s*$/.test(text.trim()))

                    log("[Fold] Processing line", {
                        text: text.trim(),
                        shouldBeFoldable,
                        currentlyFoldable: line.isFoldable(),
                        key: line.getKey(),
                    })

                    if (shouldBeFoldable !== line.isFoldable()) {
                        line.setFoldable(shouldBeFoldable)
                        log("[Fold] Updated line foldability", {
                            key: line.getKey(),
                            foldable: shouldBeFoldable,
                        })
                    }
                })
            })
        })

        return () => {
            // Clean up click listener
            if (clickHandlerRef.current && rootElementRef.current) {
                rootElementRef.current.removeEventListener("click", clickHandlerRef.current)
                clickHandlerRef.current = null
                rootElementRef.current = null
            }
            removeClickListener()
            removeMutationListener()
        }
    }, [editor])

    return null
}
