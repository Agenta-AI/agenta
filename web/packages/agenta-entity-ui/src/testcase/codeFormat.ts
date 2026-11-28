import {createT} from "@agenta/i18n"
import testcaseCatalog from "@agenta/i18n/catalogs/entityUi.testcase"
import deepEqual from "fast-deep-equal"
import {dump as dumpYaml, load as loadYaml} from "js-yaml"

export type RootDrawerViewMode = "form" | "json" | "yaml"

export type CodeFormat = "json" | "yaml"

/** What is wrong with a text that does not parse, in words a user can act on. */
export type CodeProblem =
    | "missingComma"
    | "missingQuote"
    | "extraComma"
    | "endsEarly"
    | "notObject"
    | "other"

export interface CodeParseError {
    /** The line (from 1) the problem is on, when the parser says where. */
    line: number | null
    problem: CodeProblem
}

const tNow = createT(testcaseCatalog)

export function toCodeString(value: unknown, format: CodeFormat): string {
    if (format === "yaml") return dumpYaml(value ?? null)
    return JSON.stringify(value ?? null, null, 2) ?? ""
}

/**
 * The text the code editor sends, with the end it drops put back. The editor sends its text
 * without the spaces and line breaks at the end, and in YAML they can be part of the last value
 * (a text that keeps its last line breaks, `|+`). `shown` is the text the editor was given.
 * Remove this when the shared code editor sends its text as shown (`$getEditorCodeAsString`).
 */
export function withShownEnd(text: string, shown: string): string {
    return text.trimEnd() + shown.slice(shown.trimEnd().length)
}

/** The value of the text, or `fallback` when it does not parse. Empty YAML is `null`. */
export function parseCodeString<T = unknown>(value: string, format: CodeFormat, fallback: T): T {
    try {
        return (format === "yaml" ? (loadYaml(value) ?? null) : JSON.parse(value)) as T
    } catch {
        return fallback
    }
}

const lineAt = (text: string, position: number) =>
    text.slice(0, Math.max(0, position)).split("\n").length

/** A problem the scan found: what it is, and the offset of the line to name. */
class JsonProblem {
    constructor(
        readonly problem: CodeProblem,
        readonly at: number,
    ) {}
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/
const LITERAL = /^(?:true|false|null)\b/

/**
 * Finds the first problem of a JSON text by reading it, not from the parser's message: the
 * browsers word (and place) their messages differently, and some give no position.
 */
function findJsonProblem(text: string): JsonProblem {
    let index = 0
    const skipSpace = () => {
        while (index < text.length && /\s/.test(text[index])) index += 1
    }
    // The last character of the value before `index`: a missing comma belongs to its line.
    const afterValue = () => {
        let at = index - 1
        while (at > 0 && /\s/.test(text[at])) at -= 1
        return at
    }
    const string = () => {
        const start = index
        index += 1
        while (index < text.length) {
            const char = text[index]
            if (char === "\\") index += 2
            else if (char === '"') {
                index += 1
                return
            } else if (char === "\n") break
            else index += 1
        }
        throw new JsonProblem("missingQuote", start)
    }
    const value = (): void => {
        skipSpace()
        if (index >= text.length) throw new JsonProblem("endsEarly", text.length)
        const char = text[index]
        if (char === '"') return string()
        if (char === "{" || char === "[") return list(char === "{" ? "}" : "]")
        const rest = text.slice(index)
        const token = NUMBER.exec(rest) ?? LITERAL.exec(rest)
        if (token) {
            index += token[0].length
            return
        }
        // A word without quotes, such as `{"tier": gold}`.
        throw new JsonProblem(/[A-Za-z_]/.test(char) ? "missingQuote" : "other", index)
    }
    const list = (close: "}" | "]") => {
        index += 1
        skipSpace()
        if (text[index] === close) {
            index += 1
            return
        }
        for (;;) {
            if (close === "}") {
                skipSpace()
                if (index >= text.length) throw new JsonProblem("endsEarly", text.length)
                if (text[index] !== '"') throw new JsonProblem("missingQuote", index)
                string()
                skipSpace()
                if (index >= text.length) throw new JsonProblem("endsEarly", text.length)
                if (text[index] !== ":") throw new JsonProblem("other", index)
                index += 1
            }
            value()
            skipSpace()
            if (index >= text.length) throw new JsonProblem("endsEarly", text.length)
            const char = text[index]
            if (char === close) {
                index += 1
                return
            }
            if (char !== ",") {
                const closes = char === "}" || char === "]"
                throw new JsonProblem(closes ? "other" : "missingComma", afterValue())
            }
            const comma = index
            index += 1
            skipSpace()
            if (text[index] === close) throw new JsonProblem("extraComma", comma)
        }
    }
    try {
        value()
        skipSpace()
        if (index < text.length) {
            // A comma after the last value, or a second value after the first.
            const problem = text[index] === "," ? "extraComma" : "other"
            return new JsonProblem(problem, index)
        }
        return new JsonProblem("other", text.length)
    } catch (error) {
        if (error instanceof JsonProblem) return error
        throw error
    }
}

function jsonParseError(text: string): CodeParseError {
    const found = findJsonProblem(text)
    const at = found.problem === "endsEarly" ? text.trimEnd().length : found.at
    return {line: lineAt(text, at), problem: found.problem}
}

/** Why the text does not parse, with its line when one is known, or null when it parses. */
export function codeParseError(value: string, format: CodeFormat): CodeParseError | null {
    try {
        if (format === "yaml") loadYaml(value)
        else JSON.parse(value)
        return null
    } catch (error) {
        if (format === "json") return jsonParseError(value)
        const mark = (error as {mark?: {line?: number}}).mark
        return {line: typeof mark?.line === "number" ? mark.line + 1 : null, problem: "other"}
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
        case "notObject":
            return tNow("entityUi.testcase.codeProblemNotObject")
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
