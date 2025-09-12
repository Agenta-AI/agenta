import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"

import {PlaygroundStateData} from "../../../hooks/useStatelessVariants/types"
import {ConfigMetadata, EnhancedObjectConfig, OpenAPISpec} from "../genericTransformer/types"
import {
    extractInputKeysFromSchema,
    extractInputValues,
    extractVariables,
    extractVariablesFromJson,
} from "../inputHelpers"
import {getRequestSchema} from "../openapiUtils"
import {extractValueByMetadata} from "../valueHelpers"

import {EnhancedVariant, Message, VariantParameters} from "./types"

/**
 * Transform EnhancedVariant back to API request shape
 */
export function transformToRequestBody({
    variant,
    inputRow,
    messageRow,
    allMetadata = getAllMetadata(),
    chatHistory,
    spec: _spec,
    routePath = "",
    commitType,
    prompts,
    customProperties,
    revisionId: _revisionId,
    isChat,
    isCustom,
    appType,
    variables,
    variableValues,
}: {
    variant: EnhancedVariant
    inputRow?: PlaygroundStateData["generationData"]["inputs"]["value"][number]
    messageRow?: PlaygroundStateData["generationData"]["messages"]["value"][number]
    allMetadata?: Record<string, ConfigMetadata>
    chatHistory?: Message[]
    spec?: OpenAPISpec
    routePath?: string
    commitType?: "prompt" | "parameters"
    prompts?: any[]
    customProperties?: Record<string, any>
    revisionId?: string
    isChat?: boolean
    isCustom?: boolean
    appType?: string
    variables?: string[]
    variableValues?: Record<string, any>
}): Record<string, any> & VariantParameters {
    const data = {} as Record<string, any>
    const spec = _spec
    // Inspect request schema to determine how to map inputs for custom workflows
    const reqSchema = spec ? getRequestSchema(spec, {routePath}) : undefined
    const hasInputsProperty = Boolean((reqSchema as any)?.properties?.inputs)
    const hasMessagesProperty = Boolean((reqSchema as any)?.properties?.messages)
    const isCustomBySchema = Boolean(spec) && !hasInputsProperty && !hasMessagesProperty
    const isCustomByAppType = (appType || "").toLowerCase() === "custom"
    const isCustomFinal = Boolean(isCustom) || isCustomBySchema || isCustomByAppType

    // Helper: infer if a property schema expects a string
    const _isStringSchema = (node: any): boolean => {
        if (!node || typeof node !== "object") return false
        const t = (node as any).type
        if (typeof t === "string") return t === "string"
        if (Array.isArray(t)) return t.includes("string")
        const alts = (node as any).anyOf || (node as any).oneOf || (node as any).allOf
        if (Array.isArray(alts)) return alts.some((n) => _isStringSchema(n))
        return false
    }
    const _isNullable = (node: any): boolean => {
        if (!node || typeof node !== "object") return false
        if ((node as any).nullable === true) return true
        const t = (node as any).type
        if (t === "null") return true
        if (Array.isArray(t) && t.includes("null")) return true
        const alts = (node as any).anyOf || (node as any).oneOf || (node as any).allOf
        if (Array.isArray(alts)) return alts.some((n) => _isNullable(n))
        return false
    }
    const _getPropertySchema = (key: string): any => {
        try {
            const top = (reqSchema as any)?.properties?.[key]
            if (top) return top
            const inputs = (reqSchema as any)?.properties?.inputs?.properties?.[key]
            if (inputs) return inputs
        } catch {}
        return undefined
    }
    const _defaultForKey = (key: string): any => {
        try {
            const prop = _getPropertySchema(key)
            if (!prop) {
                // Unknown schema; prefer empty string for safety when not explicitly nullable
                return ""
            }
            if (_isStringSchema(prop)) return ""
            // If type is unknown/unspecified but not explicitly nullable, send empty string
            const hasType =
                Boolean((prop as any).type) ||
                Boolean((prop as any).anyOf) ||
                Boolean((prop as any).oneOf) ||
                Boolean((prop as any).allOf)
            if (!hasType && !_isNullable(prop)) return ""
            // Fallback: default to null for non-string or explicitly nullable types
            return null
        } catch {
            return null
        }
    }
    const enhancedPrompts = (prompts || variant?.prompts || []) as any[]
    const promptConfigs = (enhancedPrompts || []).reduce(
        (acc, prompt) => {
            const extracted = extractValueByMetadata(prompt, allMetadata)
            const name = prompt.__name
            if (!name) return acc

            acc[name] = extracted
            return acc
        },
        {} as Record<string, any>,
    )

    // Fallback: if extraction produced empty messages but enhanced prompts contain messages,
    // build a minimal messages array from the enhanced structure (role/content only)
    try {
        for (const p of enhancedPrompts || []) {
            const key = p?.__name
            if (!key) continue
            const cfg = promptConfigs[key] || (promptConfigs[key] = {})
            const hasMsgs = Array.isArray(cfg?.messages) && cfg.messages.length > 0
            const enhancedMsgs = (p as any)?.messages?.value
            if (!hasMsgs && Array.isArray(enhancedMsgs) && enhancedMsgs.length > 0) {
                cfg.messages = enhancedMsgs.map((m: any) => {
                    const role = m?.role?.value ?? m?.role ?? "user"
                    const content = (() => {
                        const c = m?.content?.value ?? m?.content
                        if (Array.isArray(c)) {
                            // Join text parts to a simple string; keep simple for fallback
                            const texts = c
                                .map((part: any) => part?.text?.value ?? part?.text ?? "")
                                .filter(Boolean)
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
        ) as Record<string, any>) || {}

    let ag_config = {
        ...promptConfigs,
        ...customConfigs,
    }

    // Fallback: if ag_config is empty,
    // but variant.parameters exists, use that
    // if (
    //     (Object.keys(ag_config).length === 0 && variant.parameters) ||
    //     commitType === "parameters"
    // ) {
    //     ag_config = variant.parameters?.ag_config || variant.parameters || {}
    // }

    // Sanitize response_format within each prompt's llm_config to avoid backend validation errors
    const sanitizeResponseFormat = (cfg: Record<string, any>) => {
        const allowedTypes = new Set(["text", "json_object", "json_schema"]) as Set<string>
        Object.values(cfg || {}).forEach((promptCfg: any) => {
            if (!promptCfg || typeof promptCfg !== "object") return
            const llmCfg = promptCfg.llm_config
            if (!llmCfg || typeof llmCfg !== "object") return
            const rf = llmCfg.response_format
            if (!rf || typeof rf !== "object") return
            const t = rf.type
            // If type missing or not allowed, drop response_format to default to text
            if (!t || typeof t !== "string" || !allowedTypes.has(t)) {
                delete llmCfg.response_format
                return
            }
            if (t === "text") {
                // Normalize to minimal shape
                llmCfg.response_format = {type: "text"}
                return
            }
            if (t === "json_object") {
                // Nothing else required; ensure no stray fields
                llmCfg.response_format = {type: "json_object"}
                return
            }
            if (t === "json_schema") {
                // Require json_schema field; if missing, drop response_format to avoid validation error
                if (!rf.json_schema || typeof rf.json_schema !== "object") {
                    delete llmCfg.response_format
                    return
                }
                // Keep only required fields
                llmCfg.response_format = {
                    type: "json_schema",
                    json_schema: rf.json_schema,
                }
            }
        })
    }

    sanitizeResponseFormat(ag_config)

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
                const msgs = Array.isArray((cfg as any)?.messages) ? (cfg as any).messages : []
                for (const m of msgs) {
                    const content = (m as any)?.content
                    if (typeof content === "string") {
                        extractVariables(content).forEach((v) => vars.add(v))
                    } else if (content && (Array.isArray(content) || typeof content === "object")) {
                        extractVariablesFromJson(content).forEach((v) => vars.add(v))
                    }
                }
                const respFmt = (cfg as any)?.llm_config?.response_format
                if (respFmt) {
                    extractVariablesFromJson(respFmt).forEach((v) => vars.add(v))
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
                const node = inputRow?.[key as keyof typeof inputRow] as
                    | EnhancedObjectConfig<any>
                    | undefined
                const value = (node as any)?.value
                if (value !== undefined) {
                    data[key] = value
                } else {
                    // Fill with placeholder so backends see the field present
                    if (!(key in data)) data[key] = _defaultForKey(key)
                }
            }
        } else {
            // Non-custom (completion): place under inputs
            if (!(isChat ?? variant?.isChat)) {
                data.inputs = extractInputValues(variant, inputRow)
            }
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
            } else if (!(isChat ?? variant?.isChat)) {
                data.inputs = {...(data.inputs || {}), ...variableValues}
            }
        }
        // Attach input_keys only for non-custom prompts (custom workflows have no prompt configs)
        if (!isCustomFinal) {
            const keys = resolvedVariables ?? (variableValues ? Object.keys(variableValues) : [])
            if (keys && keys.length > 0) {
                const promptKey = Object.keys(ag_config || {})[0]
                const target = promptKey ? (ag_config as any)[promptKey] : undefined
                if (target && typeof target === "object") {
                    target.input_keys = keys
                }
            }
        }
    } else if (resolvedVariables || variableValues) {
        // If no inputRow is provided, still include inputs and (optionally) input_keys
        const keys = isCustomFinal
            ? spec
                ? extractInputKeysFromSchema(spec, routePath)
                : []
            : (resolvedVariables ?? Object.keys(variableValues || {}))
        // Try to set input_keys on the first prompt config if present (non-custom only)
        if (!isCustomFinal && keys && keys.length > 0) {
            const promptKey = Object.keys(ag_config || {})[0]
            const target = promptKey ? (ag_config as any)[promptKey] : undefined
            if (target && typeof target === "object") {
                target.input_keys = keys
            }
        }
        if (variableValues && Object.keys(variableValues).length > 0) {
            if (isCustomFinal) {
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
        } else if (isCustomFinal) {
            // No variable values provided; still include all schema input keys with default
            const keys = spec ? extractInputKeysFromSchema(spec, routePath) : []
            keys.forEach((k) => {
                if (!(k in data)) data[k] = _defaultForKey(k)
            })
        }
    }

    // Final guards
    // 1) Ensure inputs present when variableValues exist (completion-style)
    if (!isCustomFinal) {
        if (!data.inputs && variableValues && Object.keys(variableValues).length > 0) {
            data.inputs = {...variableValues}
        }
    }
    // 2) For non-custom schemas that declare an `inputs` property,
    //    always include an `inputs` object (may be empty) to satisfy backends
    //    that require the container field. Applies to both completion and chat
    //    variants if the schema declares it.
    if (!isCustomFinal && hasInputsProperty) {
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
                if (!Object.prototype.hasOwnProperty.call(data.inputs as any, k)) {
                    const vv = variableValues ? (variableValues as any)[k] : undefined
                    ;(data.inputs as any)[k] = vv !== undefined ? vv : _defaultForKey(k)
                }
            }
        }
    }

    if (isChat ?? variant?.isChat) {
        data.messages = []
        if (chatHistory && chatHistory.length > 0) {
            data.messages.push(...chatHistory)
        } else {
            const messageHistory = messageRow?.history.value || []

            data.messages.push(
                ...messageHistory
                    .flatMap((historyMessage) => {
                        const messages = [extractValueByMetadata(historyMessage, allMetadata)]
                        if (historyMessage.__runs) {
                            const revisionId = _revisionId ?? variant?.id
                            const runMessages =
                                historyMessage.__runs[revisionId]?.message &&
                                Array.isArray(historyMessage.__runs[revisionId]?.message)
                                    ? historyMessage.__runs[revisionId]?.message
                                    : [historyMessage.__runs[revisionId]?.message]

                            if (runMessages && Array.isArray(runMessages)) {
                                for (const runMessage of runMessages) {
                                    const extracted = extractValueByMetadata(
                                        runMessage,
                                        allMetadata,
                                    )
                                    messages.push(extracted)
                                }
                            }
                        }

                        return messages
                    })
                    .filter(Boolean),
            )
        }
    }

    return data as Record<string, any> & VariantParameters
}
