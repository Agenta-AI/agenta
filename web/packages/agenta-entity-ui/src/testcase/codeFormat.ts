import {createT} from "@agenta/i18n"
import testcaseCatalog from "@agenta/i18n/catalogs/entityUi.testcase"
import deepEqual from "fast-deep-equal"
import {dump as dumpYaml, load as loadYaml} from "js-yaml"

export type RootDrawerViewMode = "form" | "json" | "yaml"

export type CodeFormat = "json" | "yaml"

/** What is wrong with a text that does not parse, in words a user can act on. */
export type CodeProblem = "missingComma" | "missingQuote" | "extraComma" | "endsEarly" | "other"

export interface CodeParseError {
    /** The parser's own message, for logs. */
    message: string
    /** The line (from 1) the problem is on, when the parser says where. */
    line: number | null
    problem: CodeProblem
}

const tNow = createT(testcaseCatalog)

export function toCodeString(value: unknown, format: CodeFormat): string {
    if (format === "yaml") return dumpYaml(value ?? null)
    return JSON.stringify(value ?? null, null, 2) ?? ""
}

export function parseCodeString<T = unknown>(value: string, format: CodeFormat, fallback: T): T {
    try {
        return (format === "yaml" ? loadYaml(value) : JSON.parse(value)) as T
    } catch {
        return fallback
    }
}

const lineAt = (text: string, position: number) =>
    text.slice(0, Math.max(0, position)).split("\n").length

/** The offset of the parser's error: "position N" (V8) or "line L column C" (Firefox). */
const errorPosition = (text: string, message: string): number | null => {
    const position = /position (\d+)/.exec(message)
    if (position) return Number(position[1])
    const lineColumn = /line (\d+) column (\d+)/.exec(message)
    if (!lineColumn) return null
    const lines = text.split("\n")
    const line = Math.min(Number(lineColumn[1]), lines.length)
    const before = lines.slice(0, line - 1).reduce((sum, item) => sum + item.length + 1, 0)
    return before + Number(lineColumn[2]) - 1
}

/** The offset of the last character before `position` that is not a space. */
const previousToken = (text: string, position: number) => {
    let index = Math.min(position, text.length) - 1
    while (index >= 0 && /\s/.test(text[index])) index -= 1
    return index
}

function jsonParseError(text: string, message: string): CodeParseError {
    const lower = message.toLowerCase()
    if (lower.includes("unexpected end") || lower.includes("end of data")) {
        return {message, line: text.split("\n").length, problem: "endsEarly"}
    }
    const position = errorPosition(text, message)
    if (position === null) return {message, line: null, problem: "other"}
    // The parser reached the end while it still waited for more.
    if (position >= text.trimEnd().length) {
        return {message, line: text.trimEnd().split("\n").length, problem: "endsEarly"}
    }
    if (lower.includes("unterminated string") || lower.includes("bad control character")) {
        return {message, line: lineAt(text, position), problem: "missingQuote"}
    }
    const before = previousToken(text, position)
    const next = text.slice(position).trimStart()[0]
    // A comma right before a closing bracket.
    if (before >= 0 && text[before] === "," && (next === "}" || next === "]")) {
        return {message, line: lineAt(text, before), problem: "extraComma"}
    }
    // The parser stops at the next value; the comma belongs after the one before it.
    if (lower.includes("expected ','") || lower.includes("expected ',' or")) {
        return {message, line: lineAt(text, before + 1), problem: "missingComma"}
    }
    if (lower.includes("property name") || lower.includes("unexpected token")) {
        return {message, line: lineAt(text, position), problem: "missingQuote"}
    }
    return {message, line: lineAt(text, position), problem: "other"}
}

/** Why the text does not parse, with the line when the parser says it, or null when it does. */
export function codeParseError(value: string, format: CodeFormat): CodeParseError | null {
    try {
        if (format === "yaml") loadYaml(value)
        else JSON.parse(value)
        return null
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (format === "json") return jsonParseError(value, message)
        const mark = (error as {mark?: {line?: number}}).mark
        return {
            message: message.split("\n")[0] || message,
            line: typeof mark?.line === "number" ? mark.line + 1 : null,
            problem: "other",
        }
    }
}

const problemText = (problem: CodeProblem) => {
    switch (problem) {
        case "missingComma":
            return tNow("entityUi.testcase.codeProblemMissingComma")
        case "missingQuote":
            return tNow("entityUi.testcase.codeProblemMissingQuote")
        case "extraComma":
            return tNow("entityUi.testcase.codeProblemExtraComma")
        case "endsEarly":
            return tNow("entityUi.testcase.codeProblemEndsEarly")
        default:
            return tNow("entityUi.testcase.codeProblemOther")
    }
}

/** The sentence under a code editor whose text does not parse, in the active language. */
export function codeErrorText(error: CodeParseError, format: CodeFormat): string {
    const name = format === "json" ? "JSON" : "YAML"
    const problem = problemText(error.problem)
    return error.line === null
        ? tNow("entityUi.testcase.codeErrorNoLine", {format: name, problem})
        : tNow("entityUi.testcase.codeError", {format: name, problem, line: error.line})
}

/** Whether the typed text already says `value`, so a resync would only reformat it. */
export function textMatchesValue(text: string, format: CodeFormat, value: unknown): boolean {
    const typed = parseCodeString<unknown>(text, format, undefined)
    if (typed === undefined) return false
    return deepEqual(typed, value)
}
