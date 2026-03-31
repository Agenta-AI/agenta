import {createLogger} from "@agenta/shared/utils"
import {$createCodeNode, $isCodeHighlightNode} from "@lexical/code"
import {
    ShikiTokenizer,
    isCodeLanguageLoaded,
    loadCodeLanguage,
    loadCodeTheme,
    normalizeCodeLanguage,
} from "@lexical/code-shiki"
import {$createTextNode, $isLineBreakNode, $isTabNode} from "lexical"
import Prism from "prismjs"
import "prismjs/components/prism-json"
import "prismjs/components/prism-yaml"
import "prismjs/components/prism-python"
import "prismjs/components/prism-javascript"
import "prismjs/components/prism-typescript"
import type {Token as PrismToken} from "prismjs"

import type {CodeLanguage} from "../types"

/**
 * Represents a syntax token with content and type.
 * Used for syntax highlighting in the code editor.
 */
export interface Token {
    /** The actual text content of the token */
    content: string
    /** The type of token (e.g. 'string', 'number', 'punctuation') */
    type: string
    /** Optional inline style from Shiki output */
    style?: string
}

/**
 * Tokenizes a line of code using Prism's syntax highlighting rules.
 *
 * Takes a line of text and language identifier, and returns an array of tokens
 * that can be used to apply syntax highlighting. Uses Prism's grammar rules
 * for JSON and YAML.
 *
 * @param line - The line of code to tokenize
 * @param language - The language to use for tokenization ('json' or 'yaml')
 * @returns Array of tokens with content and type
 */
const LANGUAGE_GRAMMAR_MAP: Record<CodeLanguage, string> = {
    json: "json",
    yaml: "yaml",
    code: "python",
    python: "python",
    javascript: "javascript",
    typescript: "typescript",
}

const SHIKI_THEME = "one-light"
const tokenizerLog = createLogger("CodeTokenizer", {disabled: true})
const DEBUG_TOKENIZER = false
const TOKENIZER_VERBOSE_LOG_LIMIT = 40
const TOKENIZER_LOG_SAMPLE_INTERVAL = 500
let tokenizerCallCount = 0
const KEYWORD_TOKEN_VALUES = new Set([
    "true",
    "false",
    "null",
    "undefined",
    "if",
    "else",
    "for",
    "while",
    "return",
    "function",
    "const",
    "let",
    "var",
    "class",
    "import",
    "from",
    "export",
    "default",
    "new",
    "try",
    "catch",
    "finally",
    "throw",
    "async",
    "await",
    "def",
    "match",
    "case",
    "pass",
    "break",
    "continue",
    "in",
    "as",
])

const NUMERIC_LITERAL_REGEX = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const PUNCTUATION_REGEX = /^[\[\]{}():,.;]+$/

let shikiThemeReady = false
let shikiThemeLoadPromise: Promise<void> | null = null
const shikiLanguageLoadPromises = new Map<string, Promise<void>>()
const PRISM_FIRST_LANGUAGES = new Set<CodeLanguage>(["json", "yaml"])

export function $tokenizeCodeLine(line: string, language: CodeLanguage): Token[] {
    tokenizerCallCount += 1
    const shouldLogTokenization =
        DEBUG_TOKENIZER &&
        (tokenizerCallCount <= TOKENIZER_VERBOSE_LOG_LIMIT ||
            tokenizerCallCount % TOKENIZER_LOG_SAMPLE_INTERVAL === 0)

    // JSON/YAML are the hottest paths in the schema editor.
    // Prism is materially faster here and preserves property token classes reliably.
    if (PRISM_FIRST_LANGUAGES.has(language)) {
        const tokens = tokenizeCodeLineWithPrism(line, language)
        shouldLogTokenization &&
            tokenizerLog("tokenize(prism)", {
                language,
                tokenizerCallCount,
                linePreview: line.slice(0, 120),
                lineLength: line.length,
                tokenCount: tokens.length,
                tokenTypes: tokens.slice(0, 8).map((token) => token.type),
            })
        return tokens
    }

    const shikiLanguage = resolveShikiLanguage(language)
    ensureShikiReady(shikiLanguage)

    if (shikiThemeReady && isCodeLanguageLoaded(shikiLanguage)) {
        try {
            const tokens = $tokenizeCodeLineWithShiki(line, shikiLanguage)
            shouldLogTokenization &&
                tokenizerLog("tokenize(shiki)", {
                    language,
                    shikiLanguage,
                    tokenizerCallCount,
                    linePreview: line.slice(0, 120),
                    lineLength: line.length,
                    tokenCount: tokens.length,
                    tokenTypes: tokens.slice(0, 8).map((token) => token.type),
                })
            return tokens
        } catch {
            // Fall through to Prism for resilient behavior while migrating.
        }
    }

    const tokens = tokenizeCodeLineWithPrism(line, language)
    shouldLogTokenization &&
        tokenizerLog("tokenize(prism-fallback)", {
            language,
            shikiLanguage,
            tokenizerCallCount,
            linePreview: line.slice(0, 120),
            lineLength: line.length,
            tokenCount: tokens.length,
            tokenTypes: tokens.slice(0, 8).map((token) => token.type),
        })
    return tokens
}
/** @deprecated renamed to {@link $tokenizeCodeLine} by @lexical/eslint-plugin rules-of-lexical */
export const tokenizeCodeLine = $tokenizeCodeLine

function resolveShikiLanguage(language: CodeLanguage): string {
    const mapped = LANGUAGE_GRAMMAR_MAP[language]
    const normalized = normalizeCodeLanguage(mapped)
    return normalized || mapped
}

function ensureShikiReady(language: string) {
    if (!shikiThemeReady && !shikiThemeLoadPromise) {
        try {
            shikiThemeLoadPromise = Promise.resolve(loadCodeTheme(SHIKI_THEME))
                .then(() => {
                    shikiThemeReady = true
                })
                .catch(() => {
                    // Keep fallback tokenizer active when Shiki init fails.
                })
                .finally(() => {
                    shikiThemeLoadPromise = null
                })
        } catch {
            // Keep fallback tokenizer active when Shiki init fails.
        }
    }

    if (isCodeLanguageLoaded(language) || shikiLanguageLoadPromises.has(language)) {
        return
    }

    let languageLoad: Promise<void> | undefined
    try {
        languageLoad = loadCodeLanguage(language)
    } catch {
        return
    }

    const loadPromise = Promise.resolve(languageLoad)
        .catch(() => {
            // Keep fallback tokenizer active when Shiki language load fails.
        })
        .finally(() => {
            shikiLanguageLoadPromises.delete(language)
        })
    shikiLanguageLoadPromises.set(language, loadPromise)
}

function $tokenizeCodeLineWithShiki(line: string, language: string): Token[] {
    const codeNode = $createCodeNode(language)
    codeNode.setTheme(SHIKI_THEME)
    codeNode.append($createTextNode(line))

    const nodes = ShikiTokenizer.$tokenize(codeNode, language)
    const tokens: Token[] = []

    for (const node of nodes) {
        if ($isCodeHighlightNode(node)) {
            const content = node.getTextContent()
            if (content.length === 0) {
                continue
            }
            const shikiType = node.getHighlightType()
            const style = node.getStyle()
            const token: Token = {
                content,
                // Preserve Shiki token classes when available; fallback inference keeps
                // resilient behavior for empty/unknown classes.
                type: shikiType && shikiType !== "plain" ? shikiType : inferTokenType(content),
            }
            if (style) {
                token.style = style
            }
            tokens.push(token)
            continue
        }

        if ($isTabNode(node)) {
            tokens.push({content: "\t", type: "plain"})
            continue
        }

        if ($isLineBreakNode(node)) {
            tokens.push({content: "\n", type: "plain"})
        }
    }

    return tokens.length > 0 ? tokens : [{content: line, type: "plain"}]
}

function inferTokenType(content: string): string {
    const trimmed = content.trim()
    if (!trimmed) {
        return "plain"
    }

    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith("`") && trimmed.endsWith("`"))
    ) {
        return "string"
    }

    if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
    ) {
        return "comment"
    }

    if (NUMERIC_LITERAL_REGEX.test(trimmed)) {
        return "number"
    }

    if (PUNCTUATION_REGEX.test(trimmed)) {
        return "punctuation"
    }

    if (KEYWORD_TOKEN_VALUES.has(trimmed)) {
        return "keyword"
    }

    return "plain"
}

function tokenizeCodeLineWithPrism(line: string, language: CodeLanguage): Token[] {
    const targetGrammar = LANGUAGE_GRAMMAR_MAP[language]
    const grammar =
        Prism.languages[targetGrammar] ??
        Prism.languages.javascript ??
        Prism.languages.clike ??
        null
    if (!grammar) return [{content: line, type: "plain"}]

    const rawTokens = Prism.tokenize(line, grammar)
    return flattenTokens(rawTokens)
}

/**
 * Flattens Prism's nested token structure into a flat array.
 *
 * Prism returns a complex nested structure of tokens that can include:
 * - Plain strings (for non-highlighted text)
 * - Token objects with string content
 * - Token objects with nested token arrays
 *
 * This function converts that into a flat array of simple Token objects
 * that are easier to work with in the editor.
 *
 * @param tokens - Array of Prism tokens or strings
 * @returns Flattened array of Token objects
 */
function flattenTokens(tokens: (string | PrismToken)[]): Token[] {
    const result: Token[] = []

    for (const token of tokens) {
        if (typeof token === "string") {
            result.push({content: token, type: "plain"})
        } else {
            const tokenType = Array.isArray(token.type) ? token.type.join(".") : token.type

            if (typeof token.content === "string") {
                result.push({content: token.content, type: tokenType})
            } else if (Array.isArray(token.content)) {
                result.push(...flattenTokens(token.content))
            }
        }
    }

    return result
}
