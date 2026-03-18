import {$generateNodesFromDOM} from "@lexical/html"
import {$convertFromMarkdownString} from "@lexical/markdown"
import {$createParagraphNode, $createTextNode, $getRoot, type LexicalEditor} from "lexical"
import {Parser, marked} from "marked"

import {PLAYGROUND_TRANSFORMERS} from "../assets/transformers"

const MARKDOWN_TOKEN_CHUNK_CHAR_THRESHOLD = 20_000
const MARKDOWN_TOKEN_CHUNK_LINE_THRESHOLD = 400

type MarkdownTokenBatch = ReturnType<typeof marked.lexer>

function countLineBreaks(value: string): number {
    let lineBreaks = 0

    for (let i = 0; i < value.length; i += 1) {
        if (value.charCodeAt(i) === 10) {
            lineBreaks += 1
        }
    }

    return lineBreaks
}

function sliceTokenBatch(
    tokens: MarkdownTokenBatch,
    startIndex: number,
    endIndex: number,
): MarkdownTokenBatch {
    const batch = tokens.slice(startIndex, endIndex) as MarkdownTokenBatch

    if ("links" in tokens) {
        Object.assign(batch, {links: tokens.links})
    }

    return batch
}

function batchMarkdownTokens(markdown: string): MarkdownTokenBatch[] {
    const tokens = marked.lexer(markdown) as MarkdownTokenBatch

    if (tokens.length <= 1) {
        return [tokens]
    }

    const batches: MarkdownTokenBatch[] = []
    let batchStart = 0
    let charCount = 0
    let lineCount = 0

    for (let index = 0; index < tokens.length; index += 1) {
        const raw =
            "raw" in tokens[index] && typeof tokens[index].raw === "string" ? tokens[index].raw : ""
        const nextCharCount = charCount + raw.length
        const nextLineCount = lineCount + countLineBreaks(raw) + 1

        if (
            index > batchStart &&
            (nextCharCount > MARKDOWN_TOKEN_CHUNK_CHAR_THRESHOLD ||
                nextLineCount > MARKDOWN_TOKEN_CHUNK_LINE_THRESHOLD)
        ) {
            batches.push(sliceTokenBatch(tokens, batchStart, index))
            batchStart = index
            charCount = 0
            lineCount = 0
        }

        charCount += raw.length
        lineCount += countLineBreaks(raw) + 1
    }

    if (batchStart < tokens.length) {
        batches.push(sliceTokenBatch(tokens, batchStart, tokens.length))
    }

    return batches
}

function $appendFallbackParagraph(): void {
    const paragraph = $createParagraphNode()
    paragraph.append($createTextNode(""))
    $getRoot().append(paragraph)
}

export function $importMarkdownWithHtmlBatches(editor: LexicalEditor, markdown: string): void {
    const root = $getRoot()
    root.clear()

    if (!markdown) {
        $appendFallbackParagraph()
        return
    }

    if (typeof DOMParser === "undefined") {
        $convertFromMarkdownString(markdown, PLAYGROUND_TRANSFORMERS, undefined, true)
        return
    }

    try {
        const parser = new DOMParser()
        const tokenBatches = batchMarkdownTokens(markdown)

        for (const tokenBatch of tokenBatches) {
            const html = Parser.parse(tokenBatch)
            const dom = parser.parseFromString(html, "text/html")
            const nodes = $generateNodesFromDOM(editor, dom)

            if (nodes.length > 0) {
                root.append(...nodes)
            }
        }
    } catch {
        root.clear()
        $convertFromMarkdownString(markdown, PLAYGROUND_TRANSFORMERS, undefined, true)
        return
    }

    if (root.getChildrenSize() === 0) {
        $appendFallbackParagraph()
    }
}
/** @deprecated renamed to {@link $importMarkdownWithHtmlBatches} by @lexical/eslint-plugin rules-of-lexical */
export const importMarkdownWithHtmlBatches = $importMarkdownWithHtmlBatches
