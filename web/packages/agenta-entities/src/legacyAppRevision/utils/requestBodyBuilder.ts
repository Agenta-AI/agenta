/**
 * Request Body Builder
 *
 * Builds API request bodies from enhanced variant data (prompts, custom properties,
 * metadata, input rows, chat history). This is the entity-internal implementation
 * that all callers ultimately use.
 *
 * @packageDocumentation
 */

import {extractTemplateVariables, extractTemplateVariablesFromJson} from "../../runnable/utils"
import {extractAllEndpointSchemas} from "../api"
import type {OpenAPISpec} from "../api"
import type {ConfigMetadata} from "../types/enhanced"

import {
    extractInputKeysFromSchema,
    extractInputValues,
    extractValueByMetadata,
    stripAgentaMetadataDeep,
} from "./valueExtraction"

// ---------------------------------------------------------------------------
// Duck-typed interfaces — compatible with both EnhancedVariant (OSS) and
// LegacyAppRevisionData (entity) without importing either.
// ---------------------------------------------------------------------------

/** Minimal variant shape used by the request body builder */
export interface TransformVariantInput {
    id?: string

    parameters?: unknown

    prompts?: unknown[]

    customProperties?: Record<string, unknown>
    isChat?: boolean
    [key: string]: unknown
}

/** Minimal message shape for chat history */
export interface TransformMessage {
    role: string

    content: string | unknown[]
    name?: string

    toolCalls?: unknown[]
    toolCallId?: string
}

/** Parameters for transformToRequestBody */
export interface TransformToRequestBodyParams {
    variant?: TransformVariantInput
    inputRow?: Record<string, unknown>
    messageRow?: Record<string, unknown>
    allMetadata?: Record<string, ConfigMetadata>
    chatHistory?: TransformMessage[]
    spec?: OpenAPISpec
    routePath?: string
    prompts?: unknown[]
    customProperties?: Record<string, unknown>
    revisionId?: string
    isChat?: boolean
    isCustom?: boolean
    appType?: string
    variables?: string[]
    variableValues?: Record<string, unknown>
    /** Pre-resolved ag_config from the caller (e.g. runnableBridge.configuration).
     *  Used as fallback when prompt/custom extraction yields an empty config. */
    rawAgConfig?: Record<string, unknown>
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {})

/**
 * Merge `extracted` values into `server` while preserving the server's key ordering.
 *
 * - Keys present in `server` are emitted first, in server order.
 *   If the key also exists in `extracted`, the extracted value wins.
 *   Otherwise the server value is kept (preserves fields like system_prompt).
 * - Keys only in `extracted` (new fields) are appended at the end.
 */
function mergePreservingOrder(
    server: Record<string, unknown>,
    extracted: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    // First: server keys in original order, overlaying extracted values
    for (const key of Object.keys(server)) {
        result[key] = key in extracted ? extracted[key] : server[key]
    }

    // Second: new keys from extracted that server didn't have
    for (const key of Object.keys(extracted)) {
        if (!(key in result)) {
            result[key] = extracted[key]
        }
    }

    return result
}

/**
 * Transform enhanced variant data back to API request shape.
 *
 * Accepts a duck-typed variant (compatible with both `EnhancedVariant` and
 * `LegacyAppRevisionData`) and builds the request body expected by the backend.
 */
export function transformToRequestBody({
    variant,
    inputRow,
    messageRow,
    allMetadata = {},
    chatHistory,
    spec: _spec,
    routePath = "",
    prompts,
    customProperties,
    revisionId: _revisionId,
    isChat,
    isCustom,
    appType,
    variables,
    variableValues,
    rawAgConfig,
}: TransformToRequestBodyParams): Record<string, unknown> {
    const data: Record<string, unknown> = {}
    const spec = _spec
    // Inspect request schema to determine how to map inputs for custom workflows
    const {primaryEndpoint} = spec
        ? extractAllEndpointSchemas(spec as Record<string, unknown>, routePath)
        : {primaryEndpoint: null}
    const hasInputsProperty = Boolean(primaryEndpoint?.inputsSchema)
    const hasMessagesProperty = Boolean(primaryEndpoint?.messagesSchema)
    // When isChat is explicitly true (detected via runnableBridge),
    // never treat the endpoint as custom-by-schema. The schema lookup via extractAllEndpointSchemas
    // can fail when OpenAPI path patterns don't match, producing a false positive.
    const isCustomBySchema =
        Boolean(spec) && !hasInputsProperty && !hasMessagesProperty && !(isChat ?? variant?.isChat)
    const isCustomByAppType = (appType || "").toLowerCase() === "custom"
    const isCustomFinal = Boolean(isCustom) || isCustomBySchema || isCustomByAppType

    // Helper: infer if a property schema expects a string
    const _isStringSchema = (node: unknown): boolean => {
        if (!node || typeof node !== "object") return false
        const t = (node as Record<string, unknown>).type
        if (typeof t === "string") return t === "string"
        if (Array.isArray(t)) return t.includes("string")
        const alts =
            (node as Record<string, unknown>).anyOf ||
            (node as Record<string, unknown>).oneOf ||
            (node as Record<string, unknown>).allOf
        if (Array.isArray(alts)) return alts.some((n: unknown) => _isStringSchema(n))
        return false
    }
    const _isNullable = (node: unknown): boolean => {
        if (!node || typeof node !== "object") return false
        if ((node as Record<string, unknown>).nullable === true) return true
        const t = (node as Record<string, unknown>).type
        if (t === "null") return true
        if (Array.isArray(t) && t.includes("null")) return true
        const alts =
            (node as Record<string, unknown>).anyOf ||
            (node as Record<string, unknown>).oneOf ||
            (node as Record<string, unknown>).allOf
        if (Array.isArray(alts)) return alts.some((n: unknown) => _isNullable(n))
        return false
    }
    // reqSchema is referenced by _getPropertySchema but declared later contextually;
    // we resolve it from the primary endpoint here for closure access.
    const reqSchema = primaryEndpoint?.requestSchema
    const _getPropertySchema = (key: string): unknown => {
        try {
            const reqSchemaRecord = asRecord(reqSchema)
            const properties = asRecord(reqSchemaRecord["properties"])
            const top = properties[key]
            if (top) return top
            const inputs = asRecord(asRecord(properties["inputs"])["properties"])[key]
            if (inputs) return inputs
        } catch {
            // ignore
        }
        return undefined
    }
    const _defaultForKey = (key: string): unknown => {
        try {
            const prop = _getPropertySchema(key)
            if (!prop) {
                // Unknown schema; prefer empty string for safety when not explicitly nullable
                return ""
            }
            if (_isStringSchema(prop)) return ""
            // If type is unknown/unspecified but not explicitly nullable, send empty string
            const hasType =
                Boolean((prop as Record<string, unknown>).type) ||
                Boolean((prop as Record<string, unknown>).anyOf) ||
                Boolean((prop as Record<string, unknown>).oneOf) ||
                Boolean((prop as Record<string, unknown>).allOf)
            if (!hasType && !_isNullable(prop)) return ""
            // Fallback: default to null for non-string or explicitly nullable types
            return null
        } catch {
            return null
        }
    }
    const enhancedPrompts = (prompts || variant?.prompts || []) as unknown[]
    // Get original parameters to preserve fields like input_keys, template_format
    const variantParameters = asRecord(variant?.parameters)
    const originalParams = asRecord(variantParameters["ag_config"] ?? variant?.parameters)
    const promptConfigs = (enhancedPrompts || []).reduce(
        (acc: Record<string, unknown>, prompt: unknown) => {
            const promptRecord = asRecord(prompt)
            const name = promptRecord["__name"]
            if (typeof name !== "string" || name.length === 0) return acc
            const extractedValue = extractValueByMetadata(prompt, allMetadata)
            const extracted = asRecord(extractedValue)

            // Preserve input_keys and template_format from original parameters if they exist
            const originalPromptConfig = asRecord(originalParams[name])
            if (Object.keys(originalPromptConfig).length > 0) {
                if (originalPromptConfig["input_keys"] && !extracted["input_keys"]) {
                    extracted["input_keys"] = originalPromptConfig["input_keys"]
                }
                if (originalPromptConfig["template_format"] && !extracted["template_format"]) {
                    extracted["template_format"] = originalPromptConfig["template_format"]
                }
            }

            acc[name] = extracted
            return acc
        },
        {} as Record<string, unknown>,
    )

    // Fallback: if extraction produced empty messages but enhanced prompts contain messages,
    // build a minimal messages array from the enhanced structure (role/content only)
    try {
        for (const p of enhancedPrompts || []) {
            const promptRecord = asRecord(p)
            const key = promptRecord["__name"]
            if (typeof key !== "string" || key.length === 0) continue
            const cfg = asRecord(promptConfigs[key] ?? (promptConfigs[key] = {}))
            const cfgMessages = cfg["messages"]
            const hasMsgs = Array.isArray(cfgMessages) && cfgMessages.length > 0
            const enhancedMsgs = asRecord(promptRecord["messages"])["value"]
            if (!hasMsgs && Array.isArray(enhancedMsgs) && enhancedMsgs.length > 0) {
                cfg["messages"] = enhancedMsgs.map((m: unknown) => {
                    const messageRecord = asRecord(m)
                    const roleNode = asRecord(messageRecord["role"])
                    const roleValue = roleNode["value"] ?? messageRecord["role"]
                    const role = typeof roleValue === "string" ? roleValue : "user"
                    const content = (() => {
                        const contentNode = asRecord(messageRecord["content"])
                        const c = contentNode["value"] ?? messageRecord["content"]
                        if (Array.isArray(c)) {
                            // Join text parts to a simple string; keep simple for fallback
                            const texts = c
                                .map((part: unknown) => {
                                    const partRecord = asRecord(part)
                                    const textNode = asRecord(partRecord["text"])
                                    const textValue = textNode["value"] ?? partRecord["text"] ?? ""
                                    return typeof textValue === "string"
                                        ? textValue
                                        : String(textValue ?? "")
                                })
                                .filter((text) => text.length > 0)
                            return texts.join("\n\n")
                        }
                        return c
                    })()
                    return {role, content}
                })
            }
        }
    } catch {
        // best-effort only
    }

    const customConfigs =
        (extractValueByMetadata(
            customProperties || variant?.customProperties,
            allMetadata,
        ) as Record<string, unknown>) || {}

    // Preserve custom properties from original parameters that aren't in enhanced format.
    // This handles custom apps where properties like max_tweet_length, output_format, etc.
    // are stored directly in parameters but not in the enhanced customProperties.
    //
    // When enhanced prompts exist, legacy flat fields (system_prompt, user_prompt,
    // temperature, model, etc.) in originalParams are superseded by the structured
    // prompt format (messages + llm_config) and must NOT be copied over.
    //
    // IMPORTANT: Skip this preservation when explicit customProperties were provided.
    // The enhanced custom properties represent the authoritative set — removed keys
    // (e.g. tools deleted by the user) must NOT be re-added from stale parameters.
    const hasExplicitCustomProperties =
        customProperties != null || variant?.customProperties != null
    const promptKeys = new Set(Object.keys(promptConfigs))
    const customKeys = new Set(Object.keys(customConfigs))
    const hasEnhancedPrompts = promptKeys.size > 0
    if (!hasExplicitCustomProperties) {
        for (const [key, value] of Object.entries(originalParams)) {
            // Skip if it's a prompt config or already in customConfigs
            if (promptKeys.has(key) || customKeys.has(key)) continue
            // Skip if it's a nested object with llm_config or messages (it's a prompt, not custom property)
            if (isRecord(value) && (value["llm_config"] || value["messages"])) continue
            // When enhanced prompts exist, skip primitive legacy fields (system_prompt, temperature, etc.)
            // — they are superseded by the structured prompt format
            if (
                hasEnhancedPrompts &&
                (typeof value !== "object" || value === null || Array.isArray(value))
            )
                continue
            // Preserve the custom property
            customConfigs[key] = value
        }
    }

    // Build ag_config preserving the server's field ordering.
    //
    // When rawAgConfig is available (the raw parameters from the server), use it
    // as the structural base so that:
    //   1. Field ordering matches what the server stored (ordered JSON)
    //   2. Server-only fields (system_prompt, user_prompt) are preserved
    //   3. Extracted (user-modified) values overlay the server values
    let ag_config: Record<string, unknown>
    if (rawAgConfig && Object.keys(rawAgConfig).length > 0) {
        ag_config = {...rawAgConfig}

        // Overlay extracted prompt configs while preserving server field ordering
        for (const [key, extracted] of Object.entries(promptConfigs)) {
            const serverVal = rawAgConfig[key]
            if (isRecord(serverVal) && isRecord(extracted)) {
                ag_config[key] = mergePreservingOrder(
                    serverVal as Record<string, unknown>,
                    extracted as Record<string, unknown>,
                )
            } else {
                ag_config[key] = extracted
            }
        }

        // Overlay custom configs (these are typically new/modified properties)
        for (const [key, value] of Object.entries(customConfigs)) {
            ag_config[key] = value
        }
    } else {
        ag_config = {
            ...promptConfigs,
            ...customConfigs,
        }
    }

    // Strip legacy fields that should NOT appear in execution payloads.
    // system_prompt / user_prompt are superseded by the structured messages array.
    for (const value of Object.values(ag_config)) {
        if (isRecord(value)) {
            delete value["system_prompt"]
            delete value["user_prompt"]
        }
    }

    // Sanitize response_format within each prompt's llm_config to avoid backend validation errors
    const sanitizeResponseFormat = (cfg: Record<string, unknown>) => {
        const allowedTypes = new Set(["text", "json_object", "json_schema"]) as Set<string>
        Object.values(cfg || {}).forEach((promptCfg: unknown) => {
            if (!isRecord(promptCfg)) return
            const llmCfg = promptCfg["llm_config"]
            if (!isRecord(llmCfg)) return
            const rf = llmCfg["response_format"]
            if (!isRecord(rf)) return
            const t = rf["type"]
            // If type missing or not allowed, drop response_format to default to text
            if (!t || typeof t !== "string" || !allowedTypes.has(t)) {
                delete llmCfg["response_format"]
                return
            }
            if (t === "text") {
                // Normalize to minimal shape
                llmCfg["response_format"] = {type: "text"}
                return
            }
            if (t === "json_object") {
                // Nothing else required; ensure no stray fields
                llmCfg["response_format"] = {type: "json_object"}
                return
            }
            if (t === "json_schema") {
                // Require json_schema field; if missing, drop response_format to avoid validation error
                if (!isRecord(rf["json_schema"])) {
                    delete llmCfg["response_format"]
                    return
                }
                // Keep only required fields
                llmCfg["response_format"] = {
                    type: "json_schema",
                    json_schema: rf["json_schema"],
                }
            }
        })
    }

    sanitizeResponseFormat(ag_config)

    // Strip agenta_metadata from tools and any other nested objects before sending to API
    ag_config = stripAgentaMetadataDeep(ag_config)

    data.ag_config = ag_config

    // Resolve variables (input_keys)
    // For custom workflows, do NOT infer from prompts; stick to request schema input keys.
    let resolvedVariables: string[] | undefined = variables
    try {
        if (isCustomFinal) {
            const inputKeys = spec ? extractInputKeysFromSchema(spec, routePath) : []
            resolvedVariables = inputKeys
        } else if (!resolvedVariables || resolvedVariables.length === 0) {
            const vars = new Set<string>()
            for (const cfg of Object.values(promptConfigs || {})) {
                const cfgRecord = asRecord(cfg)
                const msgs = Array.isArray(cfgRecord["messages"]) ? cfgRecord["messages"] : []
                for (const m of msgs) {
                    const content = asRecord(m)["content"]
                    if (typeof content === "string") {
                        extractTemplateVariables(content).forEach((v) => vars.add(v))
                    } else if (content && (Array.isArray(content) || typeof content === "object")) {
                        extractTemplateVariablesFromJson(content).forEach((v) => vars.add(v))
                    }
                }
                const llmConfig = asRecord(cfgRecord["llm_config"])
                const respFmt = llmConfig["response_format"]
                if (respFmt) {
                    extractTemplateVariablesFromJson(respFmt).forEach((v) => vars.add(v))
                }
            }
            resolvedVariables = Array.from(vars)
        }
    } catch {
        // best-effort; ignore extraction errors
    }

    if (inputRow) {
        if (isCustomFinal) {
            // Custom workflow: put inputs at top-level according to schema input keys
            const inputKeys = spec ? extractInputKeysFromSchema(spec, routePath) : []
            for (const key of inputKeys) {
                const node = inputRow?.[key as keyof typeof inputRow] as Record<string, unknown>
                const value = (node as Record<string, unknown>)?.value
                if (value !== undefined) {
                    data[key] = value
                } else {
                    // Fill with placeholder so backends see the field present
                    if (!(key in data)) data[key] = _defaultForKey(key)
                }
            }
        } else {
            // Non-custom (completion): place under inputs
            data.inputs = extractInputValues(inputRow)
        }
        // Merge provided variableValues on top of extracted inputs (if any)
        if (variableValues && Object.keys(variableValues).length > 0) {
            if (isCustomFinal) {
                // For custom workflows, only include keys present in the request schema
                const keys = spec ? extractInputKeysFromSchema(spec, routePath) : []
                const allowed = new Set(keys)
                Object.entries(variableValues).forEach(([k, v]) => {
                    if (allowed.has(k)) {
                        data[k] = v
                    }
                })
                // Ensure all schema keys are present; use default when missing
                keys.forEach((k) => {
                    if (!(k in data)) data[k] = _defaultForKey(k)
                })
            } else {
                data.inputs = {...(data.inputs || {}), ...variableValues}
            }
        }
        // Attach input_keys only for non-custom prompts (custom workflows have no prompt configs)
        if (!isCustomFinal) {
            const keys = resolvedVariables ?? (variableValues ? Object.keys(variableValues) : [])
            if (keys && keys.length > 0) {
                const promptKey = Object.keys(ag_config || {})[0]
                const target = promptKey
                    ? (ag_config as Record<string, unknown>)[promptKey]
                    : undefined
                if (isRecord(target)) {
                    target["input_keys"] = keys
                }
            }
        }
    } else if (resolvedVariables || variableValues) {
        // If no inputRow is provided, still include inputs and (optionally) input_keys
        const keys = isCustomByAppType
            ? spec
                ? extractInputKeysFromSchema(spec, routePath)
                : []
            : (resolvedVariables ?? Object.keys(variableValues || {}))
        // Try to set input_keys on the first prompt config if present (non-custom only)
        if (!isCustomFinal && keys && keys.length > 0) {
            const promptKey = Object.keys(ag_config || {})[0]
            const target = promptKey ? (ag_config as Record<string, unknown>)[promptKey] : undefined
            if (isRecord(target)) {
                target["input_keys"] = keys
            }
        }
        if (variableValues && Object.keys(variableValues).length > 0) {
            if (isCustomByAppType) {
                const keys = spec ? extractInputKeysFromSchema(spec, routePath) : []
                const allowed = new Set(keys)
                Object.entries(variableValues).forEach(([k, v]) => {
                    if (allowed.has(k)) {
                        data[k] = v
                    }
                })
                // Ensure all schema keys are present (use null for missing)
                keys.forEach((k) => {
                    if (!(k in data)) data[k] = null
                })
            } else {
                data.inputs = {...(data.inputs || {}), ...variableValues}
            }
        } else if (isCustomByAppType) {
            // No variable values provided; still include all schema input keys with default
            const keys = spec ? extractInputKeysFromSchema(spec, routePath) : []
            keys.forEach((k) => {
                if (!(k in data)) data[k] = _defaultForKey(k)
            })
        }
    }

    // Final guards
    // 1) Ensure inputs present when variableValues exist (completion-style)
    if (!isCustomByAppType) {
        if (!data.inputs && variableValues && Object.keys(variableValues).length > 0) {
            data.inputs = {...variableValues}
        }
    }
    // 2) For non-custom schemas that declare an `inputs` property,
    //    always include an `inputs` object (may be empty) to satisfy backends
    //    that require the container field. Applies to both completion and chat
    //    variants if the schema declares it.
    if (!isCustomByAppType && hasInputsProperty) {
        if (!("inputs" in data)) {
            data.inputs = {}
        }
        // Include all discovered variable keys with default when no value provided
        const keys: string[] =
            Array.isArray(resolvedVariables) && resolvedVariables.length
                ? resolvedVariables
                : Array.isArray(variables)
                  ? variables
                  : []
        if (Array.isArray(keys) && keys.length > 0) {
            for (const k of keys) {
                if (!k || typeof k !== "string") continue
                if (
                    !Object.prototype.hasOwnProperty.call(data.inputs as Record<string, unknown>, k)
                ) {
                    const vv = variableValues
                        ? (variableValues as Record<string, unknown>)[k]
                        : undefined
                    ;(data.inputs as Record<string, unknown>)[k] =
                        vv !== undefined ? vv : _defaultForKey(k)
                }
            }
        }
    }
    // 3) Chat variants always require an `inputs` field. The schema-based guard above
    //    may not fire when schema extraction fails to match OpenAPI paths. Ensure inputs
    //    is present with all resolved variable keys populated.
    if ((isChat ?? variant?.isChat) && !isCustomByAppType) {
        if (!("inputs" in data)) {
            data.inputs = {}
        }
        if (variableValues && Object.keys(variableValues).length > 0) {
            data.inputs = {...(data.inputs || {}), ...variableValues}
        }
        const keys = resolvedVariables ?? (variables || [])
        for (const k of keys) {
            if (!k || typeof k !== "string") continue
            if (!Object.prototype.hasOwnProperty.call(data.inputs as Record<string, unknown>, k)) {
                ;(data.inputs as Record<string, unknown>)[k] = _defaultForKey(k)
            }
        }
    }

    if (isChat ?? variant?.isChat) {
        const messages: unknown[] = []
        data.messages = messages
        if (chatHistory && chatHistory.length > 0) {
            messages.push(...chatHistory)
        } else {
            const messageHistoryValue = asRecord(asRecord(messageRow)["history"])["value"]
            const messageHistory = Array.isArray(messageHistoryValue) ? messageHistoryValue : []

            messages.push(
                ...messageHistory
                    .flatMap((historyMessage: unknown) => {
                        const historyMessageRecord = asRecord(historyMessage)
                        const extractedMessage = extractValueByMetadata(
                            historyMessageRecord,
                            allMetadata,
                        )
                        const extractedMessages = [extractedMessage]
                        const runs = asRecord(historyMessageRecord["__runs"])
                        if (Object.keys(runs).length > 0) {
                            const revisionId = _revisionId ?? variant?.id
                            const runEntry = revisionId ? asRecord(runs[revisionId]) : {}
                            const messageValue = runEntry["message"]
                            const runMessages = Array.isArray(messageValue)
                                ? messageValue
                                : messageValue !== undefined
                                  ? [messageValue]
                                  : []

                            if (runMessages && Array.isArray(runMessages)) {
                                for (const runMessage of runMessages) {
                                    const extracted = extractValueByMetadata(
                                        runMessage,
                                        allMetadata,
                                    )
                                    extractedMessages.push(extracted)
                                }
                            }
                        }

                        return extractedMessages
                    })
                    .filter(Boolean),
            )
        }
    }

    return data
}

/**
 * Pure helper for completion-style request bodies.
 */
export function toRequestBodyCompletion(args: {
    prompts?: unknown[]
    customProperties?: Record<string, unknown>
    appType?: string
    variables?: string[]
    variableValues?: Record<string, unknown>
    spec?: OpenAPISpec
    routePath?: string
    variant?: TransformVariantInput
    allMetadata?: Record<string, ConfigMetadata>
    inputRow?: Record<string, unknown>
}): Record<string, unknown> {
    const {
        prompts,
        customProperties,
        appType,
        variables,
        variableValues,
        spec,
        routePath,
        variant,
        allMetadata = {},
        inputRow,
    } = args

    return transformToRequestBody({
        variant: (variant || {}) as TransformVariantInput,
        inputRow,
        allMetadata,
        spec,
        routePath,
        prompts,
        customProperties,
        isChat: false,
        isCustom: undefined,
        appType,
        variables,
        variableValues,
    })
}

/**
 * Pure helper for chat-style request bodies.
 */
export function toRequestBodyChat(args: {
    prompts?: unknown[]
    customProperties?: Record<string, unknown>
    appType?: string
    variables?: string[]
    spec?: OpenAPISpec
    routePath?: string
    revisionId?: string
    variant?: TransformVariantInput
    allMetadata?: Record<string, ConfigMetadata>
    chatHistory?: TransformMessage[]
    messageRow?: Record<string, unknown>
}): Record<string, unknown> {
    const {
        prompts,
        customProperties,
        appType,
        variables: _variables,
        spec,
        routePath,
        revisionId,
        variant,
        allMetadata = {},
        chatHistory,
        messageRow,
    } = args

    return transformToRequestBody({
        variant: (variant || {}) as TransformVariantInput,
        messageRow,
        allMetadata,
        chatHistory,
        spec,
        routePath,
        prompts,
        customProperties,
        revisionId,
        isChat: true,
        isCustom: undefined,
        appType,
    })
}
