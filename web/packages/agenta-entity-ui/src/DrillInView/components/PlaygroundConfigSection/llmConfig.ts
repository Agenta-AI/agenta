/**
 * Pure helpers for editing an LLM config record: single-key upsert/delete,
 * the resettable key set, the "reset to server value" projection, and the
 * fallback-config react key generator.
 */

import {PROMPT_EXTENSION_KEYS} from "./constants"

export const createFallbackConfigKey = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID()
    }

    return `${Date.now()}-${Math.random()}`
}

export const updateConfigKey = (
    base: Record<string, unknown> | undefined,
    key: string,
    value: unknown,
) => {
    const next = {...(base ?? {})}
    if (value === null || value === undefined) {
        delete next[key]
    } else {
        next[key] = value
    }
    return next
}

export const getResettableLLMConfigKeys = (llmConfigProps: Record<string, unknown>) =>
    Object.keys(llmConfigProps).filter(
        (key) => key !== "model" && !PROMPT_EXTENSION_KEYS.includes(key),
    )

export const resetLLMParameterFields = ({
    base,
    resetBase,
    resetKeys,
}: {
    base: Record<string, unknown> | undefined
    resetBase: Record<string, unknown> | undefined
    resetKeys: string[]
}) => {
    const next = {...(base ?? {})}
    const keysToReset = ["model", ...resetKeys]
    keysToReset.forEach((key) => {
        if (resetBase && Object.prototype.hasOwnProperty.call(resetBase, key)) {
            next[key] = resetBase[key]
        } else {
            delete next[key]
        }
    })
    return next
}
