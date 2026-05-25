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

interface Rule {
    name: string
    extract: (value: unknown, ctx: RuleContext) => Preview | null
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const isDefined = (value: unknown): boolean => value !== undefined && value !== null

const chatRule: Rule = {
    name: "chat",
    extract: (value, ctx) => {
        const messages = extractChatMessages(value, {prefer: ctx.side})
        if (!messages) return null
        return {renderer: "chat", data: messages, source: "chat"}
    },
}

// Matches `{input: <defined>}` shapes (e.g. agenta input payloads) and
// surfaces only that key.
const inputKeyRule: Rule = {
    name: "input-key",
    extract: (value) => {
        if (!isPlainObject(value)) return null
        if (!isDefined(value.input)) return null
        return {renderer: "beautified", data: {input: value.input}, source: "input-key"}
    },
}

// Matches `{returnValues: {output: <defined>}}` shapes and surfaces only the
// nested `output` field.
const outputKeyRule: Rule = {
    name: "output-key",
    extract: (value) => {
        if (!isPlainObject(value)) return null
        const rv = value.returnValues
        if (!isPlainObject(rv)) return null
        if (!isDefined(rv.output)) return null
        return {renderer: "beautified", data: {output: rv.output}, source: "output-key"}
    },
}

// Matches LangChain-style LLMResult payloads:
//   {generations: [[{text: "...", generationInfo: {...}}, ...], ...], ...}
// The outer list is per-prompt, the inner list is per-choice. Flattens both
// and surfaces the non-empty text values. Collapses to {output: "..."} when
// there is exactly one text, otherwise returns {outputs: [...]}.
const generationsOutputRule: Rule = {
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
        if (texts.length === 1) {
            return {renderer: "beautified", data: {output: texts[0]}, source: "generations-output"}
        }
        return {renderer: "beautified", data: {outputs: texts}, source: "generations-output"}
    },
}

const RULES: Rule[] = [chatRule, inputKeyRule, outputKeyRule, generationsOutputRule]

export const extractPreview = (value: unknown, side?: ChatExtractionPreference): Preview => {
    const {parsed} = tryParseJson(value)
    const candidate = parsed ?? value
    const ctx: RuleContext = {side}

    for (const rule of RULES) {
        const result = rule.extract(candidate, ctx)
        if (result) return result
    }

    return {renderer: "json", data: candidate, source: "fallback"}
}
