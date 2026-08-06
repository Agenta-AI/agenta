import {createLogger} from "@agenta/shared/utils"
import {
    $addUpdateTag,
    $createRangeSelection,
    $hasUpdateTag,
    $getNodeByKey,
    $getSelection,
    $isRangeSelection,
    $isTextNode,
    $setSelection,
    COMMAND_PRIORITY_LOW,
    LexicalNode,
    NodeKey,
    RangeSelection,
    TextNode,
    type LexicalEditor,
} from "lexical"

import {INITIAL_CONTENT_COMMAND} from "../../../../commands/InitialContentCommand"
import {editorStateAtom, store} from "../../index"
import {
    $createBase64Node,
    $isBase64Node,
    isBase64String,
    parseBase64String,
} from "../../nodes/Base64Node"
import {
    $createCodeHighlightNode,
    $isCodeHighlightNode,
    CodeHighlightNode,
} from "../../nodes/CodeHighlightNode"
import {$isCodeLineNode, CodeLineNode} from "../../nodes/CodeLineNode"
import {$isCodeTabNode} from "../../nodes/CodeTabNode"
import {
    $createLongTextNode,
    $isLongTextNode,
    isLongTextString,
    parseLongTextString,
} from "../../nodes/LongTextNode"
import {getDiffRange} from "../../utils/getDiffRange"
import {isPluginLocked, lockPlugin, unlockPlugin} from "../../utils/pluginLocks"
import {$getCodeBlockForLine, $getLineCount} from "../../utils/segmentUtils"
import {tokenizeCodeLine} from "../../utils/tokenizer"
import {FOLD_UPDATE_TAG} from "../folding/controller"

import {
    ENTER_KEY_UPDATE_TAG,
    HIGHLIGHT_ONLY_UPDATE_TAG,
    INITIAL_CONTENT_UPDATE_TAG,
} from "./updateTags"

// Lazy import to avoid circular dependency — BULK_CLEAR_UPDATE_TAG is a plain string constant
const BULK_CLEAR_UPDATE_TAG = "agenta:bulk-clear"

const PLUGIN_NAME = "SyntaxHighlightPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true})
const DEBUG_LOGS = false
const DEBUG_ENTER_UPDATE_PROFILE = true
const MAX_LINES_FOR_LIVE_HIGHLIGHT = Number.POSITIVE_INFINITY
const LARGE_DOC_ACTIVE_LINE_ONLY_THRESHOLD = 1200
const TRANSFORM_VERBOSE_LOG_LIMIT = 40
const TRANSFORM_LOG_SAMPLE_INTERVAL = 500

interface CachedTokenEntry {
    text: string
    language: string
    tokens: ReturnType<typeof tokenizeCodeLine>
}

interface EnterUpdateProfile {
    startedAtMs: number
    transformCalls: number
    skippedLargeDocLines: number
    tokenizedLines: number
    tokenizeMs: number
    selectionRetainMs: number
    spliceMs: number
}

function getNow(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now()
    }
    return Date.now()
}

function $updateAndRetainSelection(
    lineKey: NodeKey,
    previousSelection: RangeSelection | undefined,
    fn: () => boolean,
): void {
    const lineNode = $getNodeByKey(lineKey)
    const node = lineNode || null
    if (!node || !$isCodeLineNode(node) || !node.isAttached()) return

    const selection = $getSelection()
    if (!previousSelection || !$isRangeSelection(selection)) {
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
            const nextSelection = $createRangeSelection()

            if (previousSelection.anchor.getNode().getTextContent() === child.getTextContent()) {
                nextSelection.anchor.set(child.getKey(), previousSelection.anchor.offset, "text")
                nextSelection.focus.set(child.getKey(), previousSelection.focus.offset, "text")
            } else {
                nextSelection.anchor.set(child.getKey(), remainingOffset, "text")
                nextSelection.focus.set(child.getKey(), remainingOffset, "text")
            }
            $setSelection(nextSelection)
            break
        }
        remainingOffset -= size
    }
}

export interface SyntaxHighlightCoreConfig {
    disableLongText?: boolean
}

export function registerSyntaxHighlightCore(
    editor: LexicalEditor,
    {disableLongText = false}: SyntaxHighlightCoreConfig = {},
): () => void {
    log("registerSyntaxHighlightCore", {
        editorKey: editor.getKey(),
        disableLongText,
    })
    let transformCallCount = 0
    let enterUpdateProfile: EnterUpdateProfile | null = null
    const tokenCache = new Map<NodeKey, CachedTokenEntry>()
    let cachedSelectionSignature: string | null = null
    let cachedActiveLineKey: NodeKey | null = null

    const getSelectionSignature = (selection: RangeSelection): string => {
        return `${selection.anchor.key}:${selection.anchor.offset}|${selection.focus.key}:${selection.focus.offset}`
    }

    const getLineKeyFromNode = (node: LexicalNode): NodeKey | null => {
        let current: LexicalNode | null = node
        while (current) {
            if ($isCodeLineNode(current)) {
                return current.getKey()
            }
            current = current.getParent()
        }
        return null
    }

    const $getActiveLineKey = (): NodeKey | null => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
            cachedSelectionSignature = null
            cachedActiveLineKey = null
            return null
        }

        const signature = getSelectionSignature(selection)
        if (signature === cachedSelectionSignature) {
            return cachedActiveLineKey
        }

        cachedSelectionSignature = signature
        const anchorLineKey = getLineKeyFromNode(selection.anchor.getNode())
        const focusLineKey = getLineKeyFromNode(selection.focus.getNode())
        cachedActiveLineKey = anchorLineKey ?? focusLineKey
        return cachedActiveLineKey
    }

    const startEnterUpdateProfile = (isEnterUpdate: boolean): EnterUpdateProfile | null => {
        if (!DEBUG_ENTER_UPDATE_PROFILE || !isEnterUpdate) {
            return null
        }

        if (!enterUpdateProfile) {
            enterUpdateProfile = {
                startedAtMs: getNow(),
                transformCalls: 0,
                skippedLargeDocLines: 0,
                tokenizedLines: 0,
                tokenizeMs: 0,
                selectionRetainMs: 0,
                spliceMs: 0,
            }
        }

        return enterUpdateProfile
    }

    const $transformLine = (lineNode: CodeLineNode) => {
        if ($hasUpdateTag(BULK_CLEAR_UPDATE_TAG)) {
            return
        }
        if ($hasUpdateTag("segment-rebalance")) {
            return
        }
        if ($hasUpdateTag(FOLD_UPDATE_TAG)) {
            return
        }
        if ($hasUpdateTag(INITIAL_CONTENT_UPDATE_TAG)) {
            return
        }
        transformCallCount += 1
        const isEnterUpdate = $hasUpdateTag(ENTER_KEY_UPDATE_TAG)
        const enterProfile = startEnterUpdateProfile(isEnterUpdate)
        if (enterProfile) {
            enterProfile.transformCalls += 1
        }
        const shouldLogTransform =
            DEBUG_LOGS &&
            (transformCallCount <= TRANSFORM_VERBOSE_LOG_LIMIT ||
                transformCallCount % TRANSFORM_LOG_SAMPLE_INTERVAL === 0)
        const lineKey = lineNode.getKey()
        shouldLogTransform &&
            log(`🎨 [SyntaxHighlightPlugin] $transformLine called:`, {
                lineKey,
                transformCallCount,
            })

        const parent = $getCodeBlockForLine(lineNode)
        shouldLogTransform &&
            log(`🔍 [SyntaxHighlightPlugin] Checking conditions:`, {
                lineKey,
                hasParent: !!parent,
                isCodeBlockParent: !!parent,
                isPluginLocked: isPluginLocked(PLUGIN_NAME),
            })

        if (!parent) {
            shouldLogTransform &&
                log(
                    `⚠️ [SyntaxHighlightPlugin] Skipped line ${lineKey} - parent is not CodeBlockNode`,
                )
            return
        }
        const lineCount = $getLineCount(parent)
        if (lineCount > MAX_LINES_FOR_LIVE_HIGHLIGHT) {
            // Large docs: skip live retokenization to keep typing responsive.
            shouldLogTransform &&
                log(`⚠️ [SyntaxHighlightPlugin] Skipped line ${lineKey} - line threshold`, {
                    lineCount,
                    threshold: MAX_LINES_FOR_LIVE_HIGHLIGHT,
                })
            return
        }
        if (isPluginLocked(PLUGIN_NAME)) {
            shouldLogTransform &&
                log(`🔒 [SyntaxHighlightPlugin] Skipped line ${lineKey} - plugin locked`)
            return
        }

        // Large docs: only run expensive transform work for the active line.
        // This avoids broad transform fan-out on operations like Enter.
        if (lineCount > LARGE_DOC_ACTIVE_LINE_ONLY_THRESHOLD) {
            const activeLineKey = $getActiveLineKey()
            if (activeLineKey !== lineKey) {
                if (enterProfile) {
                    enterProfile.skippedLargeDocLines += 1
                }
                shouldLogTransform &&
                    log("⏩ [SyntaxHighlightPlugin] Large doc: non-active line skipped early", {
                        lineKey,
                        lineCount,
                        activeLineKey,
                    })
                return
            }
        }

        const language = parent.getLanguage()
        const children = lineNode.getChildren()
        shouldLogTransform &&
            log("🎨 [SyntaxHighlightPlugin] Transforming line", {
                language,
            })

        const nonTabChildren = children.filter((child) => !$isCodeTabNode(child))
        const semanticTokenChildren = nonTabChildren.filter(
            (child) =>
                $isCodeHighlightNode(child) || $isBase64Node(child) || $isLongTextNode(child),
        )
        const hasOnlySemanticTokens =
            semanticTokenChildren.length > 0 &&
            semanticTokenChildren.length === nonTabChildren.length
        const hasOnlyPlainSemanticHighlights =
            semanticTokenChildren.length > 0 &&
            semanticTokenChildren.every(
                (child) =>
                    $isCodeHighlightNode(child) &&
                    child.getHighlightType() === "plain" &&
                    !child.getStyle(),
            )
        // If token nodes already exist, prefer them as canonical content source.
        // This prevents repeated concatenation of stale raw TextNodes and token nodes.
        const textSourceChildren =
            semanticTokenChildren.length > 0 ? semanticTokenChildren : nonTabChildren

        let text = ""
        for (const child of textSourceChildren) {
            text += child.getTextContent()
        }

        // Empty lines need no syntax highlighting.
        // Skipping preserves cursor-placeholder nodes created by the Enter key handler.
        if (text.length === 0) {
            return
        }

        const cached = tokenCache.get(lineKey)
        if (
            hasOnlySemanticTokens &&
            cached &&
            cached.text === text &&
            cached.language === language
        ) {
            shouldLogTransform &&
                log("⏩ [SyntaxHighlightPlugin] Fast path: semantic line unchanged", {
                    lineKey,
                })
            return
        }

        if (hasOnlySemanticTokens && !cached && !hasOnlyPlainSemanticHighlights) {
            const seededTokens = semanticTokenChildren.map((node) => {
                if ($isCodeHighlightNode(node)) {
                    return {
                        content: node.getTextContent(),
                        type: node.getHighlightType(),
                        style: node.getStyle() || undefined,
                    }
                }
                return {
                    content: node.getTextContent(),
                    type: "string",
                }
            })

            tokenCache.set(lineKey, {
                text,
                language,
                tokens: seededTokens,
            })

            shouldLogTransform &&
                log("⏩ [SyntaxHighlightPlugin] Fast path: seeded cache from semantic nodes", {
                    lineKey,
                    tokenCount: seededTokens.length,
                })
            return
        }

        let tokens: ReturnType<typeof tokenizeCodeLine>
        if (cached && cached.text === text && cached.language === language) {
            tokens = cached.tokens
        } else {
            const tokenizeStartMs = getNow()
            tokens = tokenizeCodeLine(text, language)
            if (enterProfile) {
                enterProfile.tokenizedLines += 1
                enterProfile.tokenizeMs += getNow() - tokenizeStartMs
            }
        }
        if (!cached || cached.text !== text || cached.language !== language) {
            tokenCache.set(lineKey, {
                text,
                language,
                tokens,
            })
        }
        shouldLogTransform && log("🎨 [SyntaxHighlightPlugin] Tokens after tokenization", tokens)

        const highlightChildren = children.filter(
            (child): child is LexicalNode =>
                $isCodeHighlightNode(child) || $isBase64Node(child) || $isLongTextNode(child),
        )
        const existingTokens = highlightChildren.map((n) => {
            let type = "plain"
            let style = ""
            let hasValidationError = false
            let validationMessage: string | null = null

            if ($isBase64Node(n)) {
                type = "base64"
            } else if ($isLongTextNode(n)) {
                type = "longtext"
            } else if ($isCodeHighlightNode(n)) {
                type = n.getHighlightType()
                style = n.getStyle()
                hasValidationError = n.hasValidationError()
                validationMessage = n.getValidationMessage()
            }

            return {
                content: n.getTextContent(),
                type,
                style,
                hasValidationError,
                validationMessage,
            }
        })

        const tokenMatch =
            highlightChildren.length > 0 &&
            tokens.length === existingTokens.length &&
            tokens.every((t, i) => {
                const existing = existingTokens[i]
                if (!existing) return false

                const newIsBase64 = t.type === "string" && isBase64String(t.content)
                const existingIsBase64 = existing.type === "base64"
                if (newIsBase64 && existingIsBase64) {
                    return t.content === existing.content
                }

                const newIsLongText = t.type === "string" && isLongTextString(t.content)
                const existingIsLongText = existing.type === "longtext"
                if (newIsLongText && existingIsLongText) {
                    return t.content === existing.content
                }

                return (
                    t.content === existing.content &&
                    t.type === existing.type &&
                    (t.style ?? "") === existing.style
                )
            })
        shouldLogTransform &&
            log(`🔍 [SyntaxHighlightPlugin] Token comparison:`, {
                lineKey,
                tokenMatch,
                newTokensLength: tokens.length,
                existingTokensLength: existingTokens.length,
                newTokens: tokens.map((t) => `${t.type}:${t.content}`).slice(0, 3),
                existingTokens: existingTokens.map((t) => `${t.type}:${t.content}`).slice(0, 3),
            })

        if (tokenMatch) {
            shouldLogTransform &&
                log(
                    `⏭️ [SyntaxHighlightPlugin] Tokens identical, skipping re-highlight but validation will run - line ${lineKey}`,
                )
        }

        lockPlugin(PLUGIN_NAME)
        try {
            const applyHighlightDiff = () => {
                const current = lineNode.getChildren()
                const tabs = current.filter($isCodeTabNode)
                const nonTabNodes = current.filter((child) => !$isCodeTabNode(child))
                const highlights = nonTabNodes.filter(
                    (child) =>
                        $isCodeHighlightNode(child) ||
                        $isBase64Node(child) ||
                        $isLongTextNode(child),
                )
                const hasSemanticNodes = highlights.length > 0
                const staleRawNodes = hasSemanticNodes
                    ? nonTabNodes.filter(
                          (child) =>
                              !$isCodeHighlightNode(child) &&
                              !$isBase64Node(child) &&
                              !$isLongTextNode(child),
                      )
                    : []
                const previousNodesForDiff = hasSemanticNodes ? highlights : nonTabNodes

                if (previousNodesForDiff.length === 0) {
                    return false
                }

                const firstPreviousNode = previousNodesForDiff[0]
                const firstPreviousIndex = firstPreviousNode?.getIndexWithinParent() ?? tabs.length
                if (firstPreviousIndex < tabs.length) {
                    return false
                }

                if (highlights.length > 0 && staleRawNodes.length > 0) {
                    shouldLogTransform &&
                        log("🧹 [SyntaxHighlightPlugin] Removing stale raw nodes", {
                            lineKey,
                            staleRawNodeCount: staleRawNodes.length,
                        })
                    staleRawNodes.forEach((node) => node.remove())
                }

                const spliceWithProfile = (
                    startIndex: number,
                    deleteCount: number,
                    nodesForInsertion: LexicalNode[],
                ) => {
                    if (!enterProfile) {
                        lineNode.splice(startIndex, deleteCount, nodesForInsertion)
                        return
                    }
                    const spliceStartMs = getNow()
                    lineNode.splice(startIndex, deleteCount, nodesForInsertion)
                    enterProfile.spliceMs += getNow() - spliceStartMs
                }

                const nonSemanticNodes = nonTabNodes.filter(
                    (child) =>
                        !$isCodeTabNode(child) &&
                        !$isCodeHighlightNode(child) &&
                        !$isBase64Node(child) &&
                        !$isLongTextNode(child),
                )

                const newHighlights: LexicalNode[] = tokens.map(({content, type, style}) => {
                    if (type === "string" && isBase64String(content)) {
                        const parsed = parseBase64String(content)
                        return $createBase64Node(parsed.fullValue, parsed.mimeType, type)
                    }

                    if (type === "string" && !disableLongText && isLongTextString(content)) {
                        const currentSelection = $getSelection()
                        const isUserTypingInLine =
                            $isRangeSelection(currentSelection) &&
                            currentSelection.anchor.getNode().getParent() === lineNode

                        if (!isUserTypingInLine) {
                            const parsed = parseLongTextString(content)
                            return $createLongTextNode(parsed.fullValue, type)
                        }
                    }

                    const node = $createCodeHighlightNode(content, type, false, "")
                    if (style) {
                        node.setStyle(style)
                    }

                    return node
                })

                if (!hasSemanticNodes) {
                    shouldLogTransform &&
                        log("🧩 [SyntaxHighlightPlugin] Replacing raw line with highlight nodes", {
                            lineKey,
                            startIndex: firstPreviousIndex,
                            deleteCount: nonTabNodes.length,
                            insertCount: newHighlights.length,
                        })
                    spliceWithProfile(firstPreviousIndex, nonTabNodes.length, newHighlights)
                    return true
                }

                if (tokenMatch) {
                    shouldLogTransform &&
                        log(
                            `✅ [SyntaxHighlightPlugin] Validation completed, skipping highlight update for line ${lineKey}`,
                        )
                    return nonSemanticNodes.length > 0
                }

                const {from, to, nodesForReplacement} = getDiffRange(
                    previousNodesForDiff,
                    newHighlights,
                )

                if (from === to && nodesForReplacement.length === 0) {
                    return false
                }

                const startNode = previousNodesForDiff[from]
                const startIndex =
                    startNode?.getIndexWithinParent() ??
                    (previousNodesForDiff[
                        previousNodesForDiff.length - 1
                    ]?.getIndexWithinParent() ?? tabs.length - 1) + 1
                const deleteCount = Math.max(0, to - from)
                shouldLogTransform &&
                    log("🧩 [SyntaxHighlightPlugin] Applying diff splice", {
                        lineKey,
                        startIndex,
                        deleteCount,
                        insertCount: nodesForReplacement.length,
                        currentChildrenSize: lineNode.getChildrenSize(),
                        tabsCount: tabs.length,
                        highlightsCount: highlights.length,
                        newHighlightsCount: newHighlights.length,
                    })
                // Mark this update as cosmetic only when text has not changed since the
                // previous cached tokenization pass.
                if (cached && cached.text === text && cached.language === language) {
                    $addUpdateTag(HIGHLIGHT_ONLY_UPDATE_TAG)
                }
                spliceWithProfile(startIndex, deleteCount, nodesForReplacement)
                return true
            }

            const selection = $getSelection()
            const previousSelection =
                $isRangeSelection(selection) && selection.isCollapsed()
                    ? selection.clone()
                    : undefined
            // During Enter updates, retain selection ONLY for the line that
            // currently holds the cursor.  Skipping retention for OTHER lines
            // (e.g. the original line that was split) prevents the cursor
            // from jumping back to a line it left.
            const isSelectionOnThisLine =
                $isRangeSelection(selection) &&
                getLineKeyFromNode(selection.anchor.getNode()) === lineKey
            const shouldRetainSelection =
                Boolean(previousSelection) && (!isEnterUpdate || isSelectionOnThisLine)

            if (!shouldRetainSelection) {
                applyHighlightDiff()
            } else {
                const retainSelectionStartMs = getNow()
                $updateAndRetainSelection(lineNode.getKey(), previousSelection, applyHighlightDiff)
                if (enterProfile) {
                    enterProfile.selectionRetainMs += getNow() - retainSelectionStartMs
                }
            }
        } finally {
            unlockPlugin(PLUGIN_NAME)
        }
    }

    // CodeHighlightNode has its own registered type ("code-highlight"), so
    // registerNodeTransform(TextNode, ...) does NOT fire for it — Lexical
    // dispatches transforms by exact __type, not by inheritance chain.
    // Register a dedicated transform to trigger retokenization when the
    // user types into a highlight token.
    const unregisterHighlight = editor.registerNodeTransform(CodeHighlightNode, (node) => {
        const parent = node.getParent()
        if ($isCodeLineNode(parent)) {
            $transformLine(parent)
        }
    })

    const unregisterText = editor.registerNodeTransform(TextNode, (node) => {
        // CodeTabNode extends TabNode extends TextNode — skip tab nodes
        // so the Enter/indent handlers' tab structure stays intact.
        if ($isCodeTabNode(node)) {
            return
        }
        const parent = node.getParent()
        if ($isCodeLineNode(parent)) {
            const nextSibling = node.getNextSibling()
            if ($isCodeTabNode(nextSibling)) {
                const allTrailingTabs = node.getNextSiblings().filter($isCodeTabNode)
                const allTrailingTabsContent = allTrailingTabs.map((tab) => tab.getTextContent())
                const newNode = $createCodeHighlightNode(
                    node.getTextContent() + allTrailingTabsContent.join(""),
                    "text",
                    false,
                    "",
                )
                node.replace(newNode)
                allTrailingTabs.forEach((tab) => tab.remove())
            }
        }
    })

    const unregisterLine = editor.registerNodeTransform(CodeLineNode, (line) => {
        $transformLine(line)
    })

    const unregisterLineMutationListener = editor.registerMutationListener(
        CodeLineNode,
        (mutatedNodes) => {
            mutatedNodes.forEach((mutation, key) => {
                if (mutation !== "destroyed") {
                    return
                }
                tokenCache.delete(key)
                if (cachedActiveLineKey === key) {
                    cachedActiveLineKey = null
                }
                if (DEBUG_LOGS) {
                    log("🧹 [SyntaxHighlightPlugin] cleared token cache for destroyed line", {
                        lineKey: key,
                    })
                }
            })
        },
        {skipInitialization: true},
    )

    const unregisterLineEnterMutationProfileListener = editor.registerMutationListener(
        CodeLineNode,
        (mutatedNodes, {updateTags}) => {
            if (!DEBUG_ENTER_UPDATE_PROFILE || !updateTags.has(ENTER_KEY_UPDATE_TAG)) {
                return
            }

            let created = 0
            let updated = 0
            let destroyed = 0
            mutatedNodes.forEach((mutation) => {
                if (mutation === "created") created += 1
                if (mutation === "updated") updated += 1
                if (mutation === "destroyed") destroyed += 1
            })

            log("⏱️ [SyntaxHighlightPlugin] Enter line mutation profile", {
                editorKey: editor.getKey(),
                created,
                updated,
                destroyed,
                totalMutations: mutatedNodes.size,
            })
        },
        {skipInitialization: true},
    )

    const unregisterUpdateListener = editor.registerUpdateListener(({tags}) => {
        cachedSelectionSignature = null
        cachedActiveLineKey = null

        if (!DEBUG_ENTER_UPDATE_PROFILE || !tags.has(ENTER_KEY_UPDATE_TAG)) {
            return
        }

        const profile = enterUpdateProfile
        enterUpdateProfile = null
        if (!profile) {
            log("⏱️ [SyntaxHighlightPlugin] Enter update profile", {
                editorKey: editor.getKey(),
                transformCalls: 0,
                skippedLargeDocLines: 0,
                tokenizedLines: 0,
                tokenizeMs: 0,
                selectionRetainMs: 0,
                spliceMs: 0,
                totalMs: 0,
            })
            return
        }

        const totalMs = getNow() - profile.startedAtMs
        log("⏱️ [SyntaxHighlightPlugin] Enter update profile", {
            editorKey: editor.getKey(),
            transformCalls: profile.transformCalls,
            skippedLargeDocLines: profile.skippedLargeDocLines,
            tokenizedLines: profile.tokenizedLines,
            tokenizeMs: Number(profile.tokenizeMs.toFixed(2)),
            selectionRetainMs: Number(profile.selectionRetainMs.toFixed(2)),
            spliceMs: Number(profile.spliceMs.toFixed(2)),
            totalMs: Number(totalMs.toFixed(2)),
        })
    })

    const unregisterHighlightMutationListener = editor.registerMutationListener(
        CodeHighlightNode,
        (mutatedNodes, {updateTags}) => {
            if (!DEBUG_ENTER_UPDATE_PROFILE || !updateTags.has(ENTER_KEY_UPDATE_TAG)) {
                return
            }

            let created = 0
            let updated = 0
            let destroyed = 0
            mutatedNodes.forEach((mutation) => {
                if (mutation === "created") created += 1
                if (mutation === "updated") updated += 1
                if (mutation === "destroyed") destroyed += 1
            })

            log("⏱️ [SyntaxHighlightPlugin] Enter highlight mutation profile", {
                editorKey: editor.getKey(),
                created,
                updated,
                destroyed,
                totalMutations: mutatedNodes.size,
            })
        },
        {skipInitialization: true},
    )

    const unregisterInitialContent = editor.registerCommand(
        INITIAL_CONTENT_COMMAND,
        () => {
            const editorState = store.get(editorStateAtom)
            if (editorState?.focused) {
                return false
            }
            return false
        },
        COMMAND_PRIORITY_LOW,
    )

    return () => {
        log("cleanupSyntaxHighlightCore", {
            editorKey: editor.getKey(),
        })
        unregisterHighlight()
        unregisterText()
        unregisterLine()
        unregisterLineMutationListener()
        unregisterLineEnterMutationProfileListener()
        unregisterUpdateListener()
        unregisterHighlightMutationListener()
        unregisterInitialContent()
    }
}
