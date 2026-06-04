/**
 * Unified preview dispatcher for observability table cells.
 *
 * Walks an ordered list of rules and returns a discriminated union telling the
 * caller both what data to render and which renderer to use. Always returns
 * something; the raw JSON fallback is the last rule in the list.
 */

import {extractChatMessages, type ChatExtractionPreference} from "./utils"

// Loose JSON-string parser for the pretty dispatcher.
//
// `tryParseJsonValue` in @agenta/shared is intentionally strict and leaves
// strings as strings, which is correct for the testcase / playground editors.
// The dispatcher is the one place that must look inside JSON-encoded payloads,
// because every rule below matches on object shape. A backend value like
// `'{"returnValues":{"output":"..."},"log":"..."}'` is a string at the cell
// boundary, and we need the parsed object for `outputKeyRule` to fire.
//
// Kept as a private helper in this file so nothing else can import it and
// re-introduce auto-parsing in surfaces that have intentionally moved to
// "strings stay strings".
const tryParseJsonString = (input: unknown): unknown => {
    if (typeof input !== "string") return input
    const trimmed = input.trim()
    const looksLikeContainer =
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
    if (!looksLikeContainer) return input
    try {
        const parsed = JSON.parse(trimmed)
        return typeof parsed === "object" && parsed !== null ? parsed : input
    } catch {
        return input
    }
}

export type Preview =
    | {renderer: "chat"; data: unknown[]; source: string}
    | {renderer: "pretty"; data: Record<string, unknown>; source: string}
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
// surfaces only that key. Gated on `ctx.side` so an output-side cell receiving
// `{input, output}` doesn't short-circuit to the input field.
const inputKeyRule: Rule = {
    name: "input-key",
    extract: (value, ctx) => {
        if (ctx.side === "output") return null
        if (!isPlainObject(value)) return null
        if (!isDefined(value.input)) return null
        return {renderer: "pretty", data: {input: value.input}, source: "input-key"}
    },
}

// Matches output-shaped payloads and surfaces only the output field:
//   - `{returnValues: {output: <defined>}}` (LangChain AgentExecutor)
//   - bare `{output: <defined>}`
// Gated on `ctx.side` so an input-side cell doesn't accidentally surface the
// output field when both keys are present.
const outputKeyRule: Rule = {
    name: "output-key",
    extract: (value, ctx) => {
        if (ctx.side === "input") return null
        if (!isPlainObject(value)) return null

        const rv = value.returnValues
        if (isPlainObject(rv) && isDefined(rv.output)) {
            return {renderer: "pretty", data: {output: rv.output}, source: "output-key"}
        }

        if (isDefined(value.output)) {
            return {renderer: "pretty", data: {output: value.output}, source: "output-key"}
        }

        return null
    },
}

// Matches LangChain-style LLMResult payloads:
//   {generations: [[{text: "...", generationInfo: {...}}, ...], ...], ...}
// The outer list is per-prompt, the inner list is per-choice. Flattens both
// and surfaces the non-empty text values. Collapses to {output: "..."} when
// there is exactly one text, otherwise returns {outputs: [...]}. Gated on
// `ctx.side` because the result is always output-shaped.
const generationsOutputRule: Rule = {
    name: "generations-output",
    extract: (value, ctx) => {
        if (ctx.side === "input") return null
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
            return {renderer: "pretty", data: {output: texts[0]}, source: "generations-output"}
        }
        return {renderer: "pretty", data: {outputs: texts}, source: "generations-output"}
    },
}

const RULES: Rule[] = [chatRule, inputKeyRule, outputKeyRule, generationsOutputRule]

export const extractPreview = (value: unknown, side?: ChatExtractionPreference): Preview => {
    const candidate = tryParseJsonString(value)
    const ctx: RuleContext = {side}

    for (const rule of RULES) {
        const result = rule.extract(candidate, ctx)
        if (result) return result
    }

    return {renderer: "json", data: candidate, source: "fallback"}
}
