/**
 * Unified preview dispatcher for observability table cells.
 *
 * Walks an ordered list of rules and returns a discriminated union telling the
 * caller both what data to render and which renderer to use. Always returns
 * something; the raw JSON fallback is the last rule in the list.
 */

import {extractChatMessages, tryParseJson, type ChatExtractionPreference} from "./utils"

export type Preview =
    | {renderer: "chat"; data: unknown[]; source: string}
    | {renderer: "beautified"; data: Record<string, unknown>; source: string}
    | {renderer: "json"; data: unknown; source: string}

interface RuleContext {
    side?: ChatExtractionPreference
}

interface ChatRule {
    kind: "chat"
    name: string
    extract: (value: unknown, ctx: RuleContext) => unknown[] | null
}

interface BeautifiedRule {
    kind: "beautified"
    name: string
    extract: (value: unknown, ctx: RuleContext) => Record<string, unknown> | null
}

type Rule = ChatRule | BeautifiedRule

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const isDefined = (value: unknown): boolean => value !== undefined && value !== null

const chatRule: ChatRule = {
    kind: "chat",
    name: "chat",
    extract: (value, ctx) => extractChatMessages(value, {prefer: ctx.side}),
}

// Matches `{input: <defined>}` shapes (e.g. agenta input payloads) and
// surfaces only that key.
const inputKeyRule: BeautifiedRule = {
    kind: "beautified",
    name: "input-key",
    extract: (value) => {
        if (!isPlainObject(value)) return null
        if (!isDefined(value.input)) return null
        return {input: value.input}
    },
}

// Matches `{returnValues: {output: <defined>}}` shapes and surfaces only the
// nested `output` field.
const outputKeyRule: BeautifiedRule = {
    kind: "beautified",
    name: "output-key",
    extract: (value) => {
        if (!isPlainObject(value)) return null
        const rv = value.returnValues
        if (!isPlainObject(rv)) return null
        if (!isDefined(rv.output)) return null
        return {output: rv.output}
    },
}

// Matches LangChain-style LLMResult payloads:
//   {generations: [[{text: "...", generationInfo: {...}}, ...], ...], ...}
// The outer list is per-prompt, the inner list is per-choice. Flattens both
// and surfaces the non-empty text values. Collapses to {output: "..."} when
// there is exactly one text, otherwise returns {outputs: [...]}.
const generationsOutputRule: BeautifiedRule = {
    kind: "beautified",
    name: "generations-output",
    extract: (value) => {
        if (!isPlainObject(value)) return null
        const generations = value.generations
        if (!Array.isArray(generations)) return null

        const texts: string[] = []
        for (const inner of generations) {
            if (!Array.isArray(inner)) continue
            for (const gen of inner) {
                if (isPlainObject(gen) && typeof gen.text === "string" && gen.text !== "") {
                    texts.push(gen.text)
                }
            }
        }

        if (texts.length === 0) return null
        if (texts.length === 1) return {output: texts[0]}
        return {outputs: texts}
    },
}

const RULES: Rule[] = [chatRule, inputKeyRule, outputKeyRule, generationsOutputRule]

export const extractPreview = (value: unknown, side?: ChatExtractionPreference): Preview => {
    const {parsed} = tryParseJson(value)
    const candidate = parsed ?? value
    const ctx: RuleContext = {side}

    for (const rule of RULES) {
        if (rule.kind === "chat") {
            const result = rule.extract(candidate, ctx)
            if (result) return {renderer: "chat", data: result, source: rule.name}
            continue
        }
        const result = rule.extract(candidate, ctx)
        if (result) return {renderer: "beautified", data: result, source: rule.name}
    }

    return {renderer: "json", data: candidate, source: "fallback"}
}
