/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

import type {
    EditorConfig,
    EditorThemeClasses,
    LexicalNode,
    LineBreakNode,
    NodeKey,
    SerializedTextNode,
    Spread,
    TabNode,
} from "lexical"

import {addClassNamesToElement, removeClassNamesFromElement} from "@lexical/utils"
import {$applyNodeReplacement, $isTabNode, TextNode} from "lexical"

import {Prism} from "./CodeHighlighterPrism"

export const DEFAULT_CODE_LANGUAGE = "javascript"

type SerializedCodeHighlightNode = Spread<
    {
        highlightType: string | null | undefined
        indentLevel: number
        isFirstInLine: boolean
        indented: boolean
    },
    SerializedTextNode
>

export const CODE_LANGUAGE_FRIENDLY_NAME_MAP: Record<string, string> = {
    js: "JavaScript",
    json: "JSON",
    typescript: "TypeScript",
    yaml: "YAML",
}

export const CODE_LANGUAGE_MAP: Record<string, string> = {
    javascript: "js",
    ts: "typescript",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
}

export function normalizeCodeLang(lang: string) {
    return CODE_LANGUAGE_MAP[lang] || lang
}

export function getLanguageFriendlyName(lang: string) {
    const _lang = normalizeCodeLang(lang)
    return CODE_LANGUAGE_FRIENDLY_NAME_MAP[_lang] || _lang
}

export const getDefaultCodeLanguage = (): string => DEFAULT_CODE_LANGUAGE

export const getCodeLanguages = (): Array<string> =>
    Object.keys(Prism.languages)
        .filter(
            // Prism has several language helpers mixed into languages object
            // so filtering them out here to get langs list
            (language) => typeof Prism.languages[language] !== "function",
        )
        .sort()

export class CodeHighlightNode extends TextNode {
    __highlightType: string | null | undefined
    __indentLevel: number
    __isFirstInLine: boolean
    __indented: boolean

    constructor(
        text: string = "",
        highlightType?: string | null | undefined,
        indentLevel: number = 0,
        isFirstInLine: boolean = false,
        indented: boolean = false,
        key?: NodeKey,
    ) {
        super(text, key)
        this.__highlightType = highlightType
        this.__indentLevel = indentLevel
        this.__isFirstInLine = isFirstInLine
        this.__indented = indented
        console.log("CREATE HIGHLIGHT NODE:", indentLevel, isFirstInLine, indented)
    }

    static getType(): string {
        return "code-highlight"
    }

    static clone(node: CodeHighlightNode): CodeHighlightNode {
        return new CodeHighlightNode(
            node.__text,
            node.__highlightType,
            node.__indentLevel,
            node.__isFirstInLine,
            node.__indented,
            node.__key,
        )
    }

    getHighlightType(): string | null | undefined {
        const self = this.getLatest()
        return self.__highlightType
    }

    setHighlightType(highlightType?: string | null | undefined): this {
        const self = this.getWritable()
        self.__highlightType = highlightType
        return self
    }

    getIndentLevel(): number {
        const self = this.getLatest()
        console.log("GET INDENT LEVEL:", self.__indentLevel, self)
        return self.__indentLevel
    }

    setIndentLevel(level: number): this {
        console.log("SET INDENT LEVEL:", level, this)
        const self = this.getWritable()
        self.__indentLevel = level
        return self
    }

    isFirstInLine(): boolean {
        const self = this.getLatest()
        return self.__isFirstInLine
    }

    setFirstInLine(isFirstInLine: boolean): this {
        const self = this.getWritable()
        self.__isFirstInLine = isFirstInLine
        return self
    }

    isIndented(): boolean {
        const self = this.getLatest()
        return self.__indented
    }

    setIndented(indented: boolean): this {
        const self = this.getWritable()
        self.__indented = indented
        return self
    }

    createDOM(config: EditorConfig): HTMLElement {
        const element = super.createDOM(config)
        const className = getHighlightThemeClass(config.theme, this.__highlightType)
        addClassNamesToElement(element, className)
        return element
    }

    updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
        console.log(
            "UPDATE DOM ",
            this.__key,
            "- PREV INDENT:",
            prevNode.__indentLevel,
            "NEW INDENT:",
            this.__indentLevel,
            "IS FIRST IN LINE:",
            this.__isFirstInLine,
            "INDENTED:",
            this.__indented,
        )
        const update = super.updateDOM(prevNode, dom, config)
        const prevClassName = getHighlightThemeClass(config.theme, prevNode.__highlightType)
        const nextClassName = getHighlightThemeClass(config.theme, this.__highlightType)
        if (prevClassName !== nextClassName) {
            if (prevClassName) {
                removeClassNamesFromElement(dom, prevClassName)
            }
            if (nextClassName) {
                addClassNamesToElement(dom, nextClassName)
            }
        }
        return update
    }

    static importJSON(serializedNode: SerializedCodeHighlightNode): CodeHighlightNode {
        console.log("IMPORT JSON - INDENT:", serializedNode.indentLevel)
        const node = $createCodeHighlightNode(
            serializedNode.text,
            serializedNode.highlightType,
            serializedNode.indentLevel,
            serializedNode.isFirstInLine,
            serializedNode.indented,
        )
        node.setFormat(serializedNode.format)
        node.setDetail(serializedNode.detail)
        node.setMode(serializedNode.mode)
        node.setStyle(serializedNode.style)
        return node
    }

    exportJSON(): SerializedCodeHighlightNode {
        console.log("EXPORT JSON - INDENT:", this.__indentLevel)
        return {
            ...super.exportJSON(),
            highlightType: this.getHighlightType(),
            indentLevel: this.getIndentLevel(),
            isFirstInLine: this.isFirstInLine(),
            indented: this.isIndented(),
            type: "code-highlight",
            version: 1,
        }
    }

    canInsertTextBefore(): boolean {
        return false
    }

    canInsertTextAfter(): boolean {
        return false
    }

    isToken(): boolean {
        return true
    }
}

function getHighlightThemeClass(
    theme: EditorThemeClasses,
    highlightType: string | null | undefined,
): string | null | undefined {
    return highlightType && theme && theme.codeHighlight && theme.codeHighlight[highlightType]
}

export function $createCodeHighlightNode(
    text: string = "",
    highlightType?: string | null | undefined,
    indentLevel: number = 0,
    isFirstInLine: boolean = false,
    indented: boolean = false,
): CodeHighlightNode {
    const node = new CodeHighlightNode(text, highlightType, indentLevel, isFirstInLine, indented)
    return $applyNodeReplacement(node)
}

export function $isCodeHighlightNode(
    node: LexicalNode | null | undefined,
): node is CodeHighlightNode {
    return node instanceof CodeHighlightNode
}

export function getFirstCodeNodeOfLine(
    anchor: CodeHighlightNode | TabNode | LineBreakNode,
): null | CodeHighlightNode | TabNode | LineBreakNode {
    let previousNode = anchor
    let node: null | LexicalNode = anchor
    while ($isCodeHighlightNode(node) || $isTabNode(node)) {
        previousNode = node
        node = node.getPreviousSibling()
    }
    return previousNode
}

export function getLastCodeNodeOfLine(
    anchor: CodeHighlightNode | TabNode | LineBreakNode,
): CodeHighlightNode | TabNode | LineBreakNode {
    let nextNode = anchor
    let node: null | LexicalNode = anchor
    while ($isCodeHighlightNode(node) || $isTabNode(node)) {
        nextNode = node
        node = node.getNextSibling()
    }
    return nextNode
}
