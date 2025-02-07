// Language-specific indentation rules inspired by indent.js
export const INDENTATION_RULES = {
    js: {
        increaseIndentPattern: /^.*\{[^}"']*$|^.*\([^)"']*$|^.*\[[^\]"']*$/,
        decreaseIndentPattern: /^(.*\*\/)?\s*\}|^(.*\*\/)?\s*\]|^(.*\*\/)?\s*\)/,
        indentNextLinePattern: /^.*[{\[\(]\s*$/,
        unindentedLinePattern: /^(public|private|protected)\s+\w+/,
    },
    python: {
        increaseIndentPattern: /:\s*(#.*)?$/,
        decreaseIndentPattern: /^\s*(return|break|continue|raise|pass|continue)/,
        indentNextLinePattern: /:\s*(#.*)?$/,
        unindentedLinePattern: /^(class|def|elif|else|except|finally|for|if|try|while|with)\b/,
    },
    yaml: {
        increaseIndentPattern: /^([^-].+:|^\s*-.+:|^\s*-\s*$)/,
        decreaseIndentPattern: /^$/,
        indentNextLinePattern: /^([^-].+:|^\s*-.+:|^\s*-\s*$)/,
        unindentedLinePattern: /^---/,
    },
    json: {
        increaseIndentPattern: /[{\[]\s*$/,
        decreaseIndentPattern: /^\s*[}\]],?$/,
        indentNextLinePattern: /[{\[]\s*$/,
        unindentedLinePattern: /^$/,
    },
} as const

export type SupportedLanguage = keyof typeof INDENTATION_RULES

export function getIndentationRules(language: string) {
    return INDENTATION_RULES[language as SupportedLanguage] || INDENTATION_RULES.js
}

export function shouldIncreaseIndent(line: string, language: string): boolean {
    const rules = getIndentationRules(language)
    return rules.increaseIndentPattern.test(line)
}

export function shouldDecreaseIndent(line: string, language: string): boolean {
    const rules = getIndentationRules(language)
    return rules.decreaseIndentPattern.test(line)
}

export function shouldIndentNextLine(line: string, language: string): boolean {
    const rules = getIndentationRules(language)
    return rules.indentNextLinePattern.test(line)
}

export function isUnindentedLine(line: string, language: string): boolean {
    const rules = getIndentationRules(language)
    return rules.unindentedLinePattern?.test(line) || false
}
