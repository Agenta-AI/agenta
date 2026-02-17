/**
 * Parameter Conversion Utilities
 *
 * Shared utilities for converting between enhanced prompts/properties and raw parameters.
 * Used by both the snapshot module and the store for dirty checking.
 *
 * @packageDocumentation
 */

// ============================================================================
// RAW VALUE EXTRACTION
// ============================================================================

/**
 * Extract the raw value from an enhanced property.
 * Enhanced properties have structure like { value: X, __id: ..., __metadata: ... }
 *
 * This recursively extracts values, handling:
 * - Simple enhanced values: {value: "hello", __id: ...} -> "hello"
 * - Nested enhanced values: {value: [{role: {value: "user"}}]} -> [{role: "user"}]
 * - Arrays of enhanced values
 */
export function extractRawValue(enhanced: unknown): unknown {
    if (enhanced === null || enhanced === undefined) return enhanced
    if (typeof enhanced !== "object") return enhanced

    // If it's an array, recursively extract values from each item
    if (Array.isArray(enhanced)) {
        return enhanced.map(extractRawValue)
    }

    const obj = enhanced as Record<string, unknown>

    // If it has a 'value' property AND metadata keys, it's an enhanced value wrapper
    // Extract the value and recursively process it
    if ("value" in obj && ("__id" in obj || "__metadata" in obj)) {
        return extractRawValue(obj.value)
    }

    // Otherwise, recursively process object properties (skip metadata keys)
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
        if (key.startsWith("__")) continue // Skip __id, __metadata, __test, __name
        result[key] = extractRawValue(val)
    }
    return result
}

const toSnakeCaseKey = (key: string): string =>
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

function toSnakeCaseDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(toSnakeCaseDeep)
    }
    if (!value || typeof value !== "object") return value

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const nextKey = key.startsWith("__") ? key : toSnakeCaseKey(key)
        result[nextKey] = toSnakeCaseDeep(val)
    }
    return result
}

// ============================================================================
// COMPARISON HELPERS
// ============================================================================

const VOLATILE_KEYS = new Set(["__id", "__test", "__metadata", "__name"])

/**
 * Strip volatile/metadata keys for comparison.
 * Also strips null values from message objects since server data doesn't include them.
 *
 * @param value - The value to strip volatile keys from
 * @param preserveNulls - Whether to preserve null values at the top level (default: true)
 *                        Note: null values in message objects (name, toolCalls, etc.) are always stripped
 */
export function stripVolatileKeys(value: unknown, preserveNulls = true): unknown {
    if (value === null) return preserveNulls ? null : undefined
    if (value === undefined) return undefined
    if (typeof value !== "object") return value

    if (Array.isArray(value)) {
        return value.map((v) => stripVolatileKeys(v, preserveNulls))
    }

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        // Skip all volatile/metadata keys that change between derivations
        if (VOLATILE_KEYS.has(key)) {
            continue
        }
        // Skip null values - server data doesn't include these optional fields
        // (e.g., name, toolCalls, toolCallId in message objects)
        if (val === null) {
            continue
        }
        const stripped = stripVolatileKeys(val, preserveNulls)
        if (stripped !== undefined) {
            result[key] = stripped
        }
    }
    return result
}

// ============================================================================
// ENHANCED TO PARAMETERS CONVERSION
// ============================================================================

/**
 * Convert enhanced prompts back to raw parameter format.
 * This is the inverse of the schema enhancement process.
 *
 * NOTE: We only extract the `messages` array since that's what users actually edit.
 * Other fields (llmConfig, templateFormat, etc.) are metadata that have
 * camelCase/snake_case mismatches between enhanced and server data.
 */
export function enhancedPromptsToParameters(
    enhancedPrompts: unknown[],
    baseParams: Record<string, unknown>,
): Record<string, unknown> {
    const result = {...baseParams}

    for (const prompt of enhancedPrompts) {
        if (!prompt || typeof prompt !== "object") continue

        const p = prompt as Record<string, unknown>
        const name = p.__name as string | undefined
        if (!name) continue

        // Extract the messages array - this is what users actually edit
        const messages = p.messages
        if (messages) {
            const rawMessages = extractRawValue(messages)
            const existingPrompt = (result[name] as Record<string, unknown>) || {}
            result[name] = {
                ...existingPrompt,
                messages: rawMessages,
            }
        }

        // Extract LLM config changes (model parameters) to enable dirty checks
        const llmConfig =
            (p as Record<string, unknown>).llmConfig ?? (p as Record<string, unknown>).llm_config
        if (llmConfig !== undefined && llmConfig !== null) {
            const existingPrompt = (result[name] as Record<string, unknown>) || {}
            const llmConfigKey =
                "llm_config" in existingPrompt
                    ? "llm_config"
                    : "llmConfig" in existingPrompt
                      ? "llmConfig"
                      : "llm_config"
            const rawConfig = extractRawValue(llmConfig)
            const normalizedConfig =
                llmConfigKey === "llm_config" ? toSnakeCaseDeep(rawConfig) : rawConfig

            result[name] = {
                ...existingPrompt,
                [llmConfigKey]: normalizedConfig,
            }
        }

        // Extract prompt template format changes (prompt syntax)
        const promptNode = (p as Record<string, unknown>).prompt
        const promptTemplateNode =
            promptNode && typeof promptNode === "object"
                ? (promptNode as Record<string, unknown>)
                : undefined
        const templateFormatNode =
            (p as Record<string, unknown>).templateFormat ??
            (p as Record<string, unknown>).template_format ??
            promptTemplateNode?.templateFormat ??
            promptTemplateNode?.template_format

        if (templateFormatNode !== undefined && templateFormatNode !== null) {
            const existingPrompt = (result[name] as Record<string, unknown>) || {}
            const templateKey =
                "template_format" in existingPrompt
                    ? "template_format"
                    : "templateFormat" in existingPrompt
                      ? "templateFormat"
                      : "template_format"
            const rawTemplateFormat = extractRawValue(templateFormatNode)

            result[name] = {
                ...existingPrompt,
                [templateKey]: rawTemplateFormat,
            }
        }
    }

    return result
}

/**
 * Convert enhanced custom properties back to raw parameter format.
 */
export function enhancedCustomPropertiesToParameters(
    enhancedProps: Record<string, unknown>,
    baseParams: Record<string, unknown>,
): Record<string, unknown> {
    const result = {...baseParams}

    for (const [key, val] of Object.entries(enhancedProps)) {
        if (!val || typeof val !== "object") {
            result[key] = val
            continue
        }

        const prop = val as Record<string, unknown>
        // Extract the raw value from the enhanced property
        if ("value" in prop && ("__id" in prop || "__metadata" in prop)) {
            result[key] = extractRawValue(prop.value)
        } else {
            result[key] = extractRawValue(val)
        }
    }

    return result
}

// ============================================================================
// PARAMETER COMPARISON
// ============================================================================

/**
 * Compare two parameter objects for equality.
 * Handles enhanced prompts/properties conversion and null value preservation.
 *
 * @param draftData - Draft data with potential enhanced prompts/properties
 * @param serverParams - Server parameters to compare against
 * @returns true if parameters are different (dirty), false if equal
 */
export function areParametersDifferent(
    draftData: {
        parameters?: Record<string, unknown>
        enhancedPrompts?: unknown[]
        enhancedCustomProperties?: Record<string, unknown>
    },
    serverParams: Record<string, unknown>,
): boolean {
    const hasEnhancedPrompts = draftData.enhancedPrompts && Array.isArray(draftData.enhancedPrompts)
    const hasEnhancedCustomProps =
        draftData.enhancedCustomProperties && typeof draftData.enhancedCustomProperties === "object"

    // When enhanced data exists, use SERVER params as the base for conversion.
    // This preserves key ordering from the server, preventing false positives
    // from toSnakeCaseDeep key reordering in the enhanced → raw conversion.
    let draftParams: Record<string, unknown>
    if (hasEnhancedPrompts || hasEnhancedCustomProps) {
        draftParams = {...serverParams}
    } else {
        draftParams = {...(draftData.parameters ?? {})}
    }

    // If draft has enhanced prompts, convert them back to parameters
    if (hasEnhancedPrompts) {
        draftParams = enhancedPromptsToParameters(draftData.enhancedPrompts!, draftParams)
    }

    // If draft has enhanced custom properties, convert them back to parameters
    if (hasEnhancedCustomProps) {
        draftParams = enhancedCustomPropertiesToParameters(
            draftData.enhancedCustomProperties!,
            draftParams,
        )
    }

    // Compare parameters with null preservation
    const strippedDraft = stripVolatileKeys(draftParams, true)
    const strippedServer = stripVolatileKeys(serverParams, true)
    const draftParamsStr = JSON.stringify(strippedDraft)
    const serverParamsStr = JSON.stringify(strippedServer)

    return draftParamsStr !== serverParamsStr
}
