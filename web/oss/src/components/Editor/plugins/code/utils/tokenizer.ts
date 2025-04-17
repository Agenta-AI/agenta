// utils/tokenizer.ts
import Prism from "prismjs"
import "prismjs/components/prism-json"
import "prismjs/components/prism-yaml"
import type {Token as PrismToken} from "prismjs"

/**
 * Represents a syntax token with content and type.
 * Used for syntax highlighting in the code editor.
 */
export interface Token {
    /** The actual text content of the token */
    content: string
    /** The type of token (e.g. 'string', 'number', 'punctuation') */
    type: string
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
export function tokenizeCodeLine(line: string, language: "json" | "yaml"): Token[] {
    const grammar = Prism.languages[language]
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
