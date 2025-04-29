import {LexicalNode, $createRangeSelection, $setSelection, $isTabNode} from "lexical"

import {$isCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

const log = createLogger("HorizontalNavigationPluginUtilities", {disabled: false})

/**
 * Returns true if the given token is skippable (empty, whitespace, or zero-width).
 */
export function isSkippableToken(token: LexicalNode): boolean {
    if ($isTabNode(token)) return false
    if ($isCodeHighlightNode(token)) {
        const text = token.getTextContent()
        return text === "" || text === "\u200b" || /^\s+$/.test(text)
    }
    return false
}

/**
 * Moves the caret or selection to the specified token and offset.
 * If shiftKey is true, expands selection from anchor.
 */
export function $moveCaretToToken(
    anchorToken: LexicalNode,
    focusToken: LexicalNode,
    left: boolean,
    shiftKey: boolean,
    selection: any, // RangeSelection from lexical
    overrideOffset?: number,
): boolean {
    const sel = $createRangeSelection()
    let focusOffset = 0
    if (overrideOffset !== undefined) {
        focusOffset = overrideOffset
    } else if (left) {
        focusOffset = 0
    } else {
        if (typeof focusToken.getTextContentSize === "function") {
            focusOffset = focusToken.getTextContentSize()
        } else if (typeof focusToken.getTextContent === "function") {
            focusOffset = focusToken.getTextContent().length
        } else {
            focusOffset = 0
        }
    }
    if (shiftKey && selection && "anchor" in selection && selection.anchor) {
        // Expand selection from anchor
        sel.anchor.set(
            (selection.anchor as any).getNode().getKey(),
            (selection.anchor as any).offset,
            "text",
        )
        sel.focus.set(focusToken.getKey(), focusOffset, "text")
    } else {
        sel.anchor.set(focusToken.getKey(), focusOffset, "text")
        sel.focus.set(focusToken.getKey(), focusOffset, "text")
    }
    $setSelection(sel)
    return true
}
/** @deprecated renamed to {@link $moveCaretToToken} by @lexical/eslint-plugin rules-of-lexical */
export const moveCaretToToken = $moveCaretToToken

function isZeroWidthChar(char: string | undefined) {
    return char === "\u200B" || char === undefined || char === ""
}

function skipZeroWidth(
    node: LexicalNode,
    offset: number,
    direction: "left" | "right",
): {node: LexicalNode; offset: number} | null {
    log("skipZeroWidth initial", {
        nodeType: node.getType(),
        nodeKey: node.getKey(),
        offset,
        direction,
        text:
            typeof (node as any).getTextContent === "function"
                ? (node as any).getTextContent()
                : undefined,
        charAtOffset:
            typeof (node as any).getTextContent === "function"
                ? (node as any).getTextContent()[offset]
                : undefined,
    })

    // Handle TabNode atomically
    if ($isTabNode(node)) {
        if (direction === "right") {
            const next = node.getNextSibling()
            if (next && $isCodeHighlightNode(next)) {
                const text = next.getTextContent()
                let newOffset = 0
                // Skip zero-width and quotes
                while (
                    newOffset < text.length &&
                    (isZeroWidthChar(text[newOffset]) ||
                        text[newOffset] === '"' ||
                        text[newOffset] === "'")
                ) {
                    newOffset++
                }
                // If still at 0 and there's something after, go to offset 1
                if (newOffset === 0 && text.length > 1) {
                    newOffset = 1
                }
                return {node: next, offset: newOffset}
            }
            if (next) {
                return skipZeroWidth(next, 0, direction)
            }
            const parentLine = node.getParent()
            if ($isCodeLineNode(parentLine)) {
                const nextLine = parentLine.getNextSibling()
                if (nextLine && $isCodeLineNode(nextLine) && nextLine.getChildren().length > 0) {
                    const firstChild = nextLine.getChildren()[0]
                    if ($isCodeHighlightNode(firstChild)) {
                        const text = firstChild.getTextContent()
                        let newOffset = 0
                        while (
                            newOffset < text.length &&
                            (isZeroWidthChar(text[newOffset]) ||
                                text[newOffset] === '"' ||
                                text[newOffset] === "'")
                        ) {
                            newOffset++
                        }
                        if (newOffset === 0 && text.length > 1) {
                            newOffset = 1
                        }
                        return {node: firstChild, offset: newOffset}
                    }
                    return skipZeroWidth(firstChild, 0, direction)
                }
            }
            return null
        } else {
            const prev = node.getPreviousSibling()
            if (prev) {
                // Move to end of previous node, skipping trailing zero-width chars
                if ($isCodeHighlightNode(prev)) {
                    const text = prev.getTextContent()
                    let newOffset = text.length
                    while (newOffset > 0 && isZeroWidthChar(text[newOffset - 1])) {
                        newOffset--
                    }
                    return {node: prev, offset: newOffset}
                }
                return skipZeroWidth(prev, prev.getTextContentSize(), direction)
            }
            const parentLine = node.getParent()
            if ($isCodeLineNode(parentLine)) {
                const prevLine = parentLine.getPreviousSibling()
                if (prevLine && $isCodeLineNode(prevLine) && prevLine.getChildren().length > 0) {
                    const lastChild = prevLine.getChildren()[prevLine.getChildren().length - 1]
                    if ($isCodeHighlightNode(lastChild)) {
                        const text = lastChild.getTextContent()
                        let newOffset = text.length
                        while (newOffset > 0 && isZeroWidthChar(text[newOffset - 1])) {
                            newOffset--
                        }
                        return {node: lastChild, offset: newOffset}
                    }
                    return skipZeroWidth(lastChild, lastChild.getTextContentSize(), direction)
                }
            }
            return null
        }
    }

    // Handle CodeHighlightNode
    if ($isCodeHighlightNode(node)) {
        const text = node.getTextContent()
        if (direction === "left") {
            if (offset > 0) {
                let newOffset = offset - 1
                // Skip zero-width chars
                while (newOffset > 0 && isZeroWidthChar(text[newOffset])) {
                    newOffset--
                }
                return {node, offset: newOffset}
            } else {
                // At start, jump to previous sibling or previous line
                const prev = node.getPreviousSibling()
                if (prev && $isCodeHighlightNode(prev)) {
                    const prevText = prev.getTextContent()
                    let newOffset = prevText.length
                    // If last char is a quote, skip it to get a visual move
                    if (prevText[newOffset - 1] === '"' || prevText[newOffset - 1] === "'") {
                        newOffset--
                    }
                    // If prev node's offset length and this node's offset 0 are visually the same, skip to offset length-1
                    if (newOffset === prevText.length && prevText.length > 1) {
                        newOffset = prevText.length - 1
                    }
                    return {node: prev, offset: newOffset}
                }
                if (prev) {
                    return skipZeroWidth(prev, prev.getTextContentSize(), direction)
                }
                const parentLine = node.getParent()
                if ($isCodeLineNode(parentLine)) {
                    const prevLine = parentLine.getPreviousSibling()
                    if (
                        prevLine &&
                        $isCodeLineNode(prevLine) &&
                        prevLine.getChildren().length > 0
                    ) {
                        const lastChild = prevLine.getChildren()[prevLine.getChildren().length - 1]
                        if ($isCodeHighlightNode(lastChild)) {
                            const prevText = lastChild.getTextContent()
                            let newOffset = prevText.length
                            if (
                                prevText[newOffset - 1] === '"' ||
                                prevText[newOffset - 1] === "'"
                            ) {
                                newOffset--
                            }
                            if (newOffset === prevText.length && prevText.length > 1) {
                                newOffset = prevText.length - 1
                            }
                            return {node: lastChild, offset: newOffset}
                        }
                        return skipZeroWidth(lastChild, lastChild.getTextContentSize(), direction)
                    }
                }
                return null
            }
        } else {
            if (offset < text.length) {
                let newOffset = offset + 1
                // Skip zero-width chars
                while (newOffset < text.length && isZeroWidthChar(text[newOffset])) {
                    newOffset++
                }
                log("skipZeroWidth return x0", {
                    node,
                    offset: newOffset,
                })
                return {node, offset: newOffset}
            } else {
                // At end, jump to next sibling or next line
                const next = node.getNextSibling()
                if (next && $isCodeHighlightNode(next)) {
                    const text = next.getTextContent()
                    let newOffset = 0
                    // Skip zero-width and quotes
                    while (
                        newOffset < text.length &&
                        (isZeroWidthChar(text[newOffset]) ||
                            text[newOffset] === '"' ||
                            text[newOffset] === "'")
                    ) {
                        log("skipZeroWidth FOUND ZERO WIDTH CHAR -> MOVING", {
                            text,
                            node: next,
                            offset: newOffset,
                            isZeroWidth: isZeroWidthChar(text[newOffset]),
                            char: text[newOffset],
                        })
                        newOffset++
                    }
                    // Always increment offset by 1 when coming from previous node (right navigation)
                    if (newOffset === 0 && text.length > 0) {
                        newOffset = 1
                    }
                    // Clamp to text length
                    if (newOffset > text.length) newOffset = text.length
                    log("skipZeroWidth return x1", {
                        text,
                        node: next,
                        offset: newOffset,
                        hasZeroWidth: text.indexOf("\u200b") !== -1,
                    })
                    return {node: next, offset: newOffset}
                }
                if (next) {
                    log("skipZeroWidth return x2", {
                        node: next,
                        offset: 0,
                    })
                    return skipZeroWidth(next, 0, direction)
                }
                const parentLine = node.getParent()
                if ($isCodeLineNode(parentLine)) {
                    const nextLine = parentLine.getNextSibling()
                    if (
                        nextLine &&
                        $isCodeLineNode(nextLine) &&
                        nextLine.getChildren().length > 0
                    ) {
                        const firstChild = nextLine.getChildren()[0]
                        if ($isCodeHighlightNode(firstChild)) {
                            const text = firstChild.getTextContent()
                            let newOffset = 0
                            while (
                                newOffset < text.length &&
                                (isZeroWidthChar(text[newOffset]) ||
                                    text[newOffset] === '"' ||
                                    text[newOffset] === "'")
                            ) {
                                newOffset++
                            }
                            if (newOffset === 0 && text.length > 1) {
                                newOffset = 1
                            }
                            log("skipZeroWidth return x3", {
                                firstChild,
                                newOffset,
                            })
                            return {node: firstChild, offset: newOffset}
                        }
                        log("skipZeroWidth return x4", {
                            firstChild,
                            offset: 0,
                        })
                        return skipZeroWidth(firstChild, 0, direction)
                    }
                }
                return null
            }
        }
    }

    log("skipZeroWidth return 3", {
        node,
        offset,
    })

    // Fallback: return current
    return {node, offset}
}

/**
 * Finds the next valid position for cursor placement
 * Skips zero-width characters and handles special nodes
 */
export function $findNextValidPosition(
    node: LexicalNode,
    offset: number,
    direction: "left" | "right",
): {node: LexicalNode; offset: number} | null {
    log("$findNextValidPosition initial", {
        nodeType: node.getType(),
        nodeKey: node.getKey(),
        offset,
        direction,
        text:
            typeof (node as any).getTextContent === "function"
                ? (node as any).getTextContent()
                : undefined,
    })

    log("$findNextValidPosition return", {node, offset, direction})
    return skipZeroWidth(node, offset, direction)
}
