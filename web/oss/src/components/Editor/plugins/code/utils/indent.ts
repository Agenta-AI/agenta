/**
 * Common indentation helpers shared across code-editor plugins.
 */

/**
 * Returns the number of leading whitespace characters in a line.
 * Note: tabs count as 1 character (Lexical represents them as TabNodes anyway).
 */
export function getIndentCount(text: string): number {
    return text.match(/^\s*/)?.[0].length || 0
}

/**
 * Calculates the proper indentation level for a line based on its content and context.
 * This extracts the core indentation logic from IndentationPlugin for reuse.
 *
 * @param lineText - The text content of the line to calculate indentation for
 * @param previousLineText - The text content of the previous line (for context)
 * @param baseIndentLevel - The base indentation level to start from
 * @param language - The language mode ('json' or 'yaml')
 * @returns The calculated indentation level (number of tabs)
 */
export function calculateLineIndentation(
    lineText: string,
    previousLineText: string,
    baseIndentLevel: number,
    language: "json" | "yaml",
): number {
    const trimmedLine = lineText.trim()
    const trimmedPrevious = previousLineText.trim()

    // Start with base indentation
    let indentLevel = baseIndentLevel

    // Check if previous line ends with an opening brace/bracket
    const prevEndsWithOpeningBrace =
        /[\[{(]\s*$/.test(trimmedPrevious) ||
        (language === "yaml" && (/:\s*$/.test(trimmedPrevious) || /-\s*$/.test(trimmedPrevious)))

    // If previous line opens a block, increase indentation
    if (prevEndsWithOpeningBrace) {
        indentLevel += 1
    }

    // Check if current line closes a block
    const currentLineClosesBlock = /^[\]})]/.test(trimmedLine)

    // If current line closes a block, decrease indentation
    if (currentLineClosesBlock) {
        indentLevel = Math.max(0, indentLevel - 1)
    }

    return indentLevel
}

/**
 * Calculates proper indentation for multiple lines based on their content and context.
 * This is used for paste operations to ensure pasted lines have correct indentation.
 *
 * @param lines - Array of line texts to calculate indentation for
 * @param baseIndentLevel - The base indentation level (from the line being pasted into)
 * @param language - The language mode ('json' or 'yaml')
 * @returns Array of indentation levels (number of tabs) for each line
 */
export function calculateMultiLineIndentation(
    lines: string[],
    baseIndentLevel: number,
    language: "json" | "yaml",
): number[] {
    const indentLevels: number[] = []

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i]
        const previousLine = i > 0 ? lines[i - 1] : ""

        const indentLevel = calculateLineIndentation(
            currentLine,
            previousLine,
            i === 0 ? baseIndentLevel : indentLevels[i - 1],
            language,
        )

        indentLevels.push(indentLevel)
    }

    return indentLevels
}

/**
 * Simple heuristic to decide if a line is foldable for a given language.
 * For JSON: line ending with "{".
 * For YAML: line ending with ':' (allow trailing spaces).
 */
export function isFoldableLine(text: string, language: string): boolean {
    const trimmed = text.trim()
    if (language === "json") {
        return trimmed.endsWith("{")
    }
    if (language === "yaml") {
        return /:\s*$/.test(trimmed)
    }
    // Add more languages here if needed
    return false
}
