import type {Workflow} from "@agenta/entities/workflow"
import {
    collectEvaluatorCandidates,
    resolveOutputSchema,
    resolveParameters,
    resolveParametersSchema,
    resolveScript,
} from "@agenta/entities/workflow"

import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"

import {
    MAX_PARAMETER_PREVIEW_LENGTH,
    PARAMETER_KEYS_TO_IGNORE,
    PROMPT_KEY_LOOKUP,
} from "../constants"
import type {
    OutputMetric,
    ParameterPreviewItem,
    PromptPreviewAttachment,
    PromptPreviewSection,
} from "../types"

export const capitalize = (value?: string) =>
    value ? value.charAt(0).toUpperCase() + value.slice(1) : undefined

/**
 * Resolve the evaluator type (category slug + display label) from a workflow entity.
 *
 * Uses a two-tier lookup:
 * 1. **Catalog lookup** (preferred): match the evaluator key against the
 *    pre-built lookup map derived from catalog template `categories`.
 * 2. **Flag-based inference** (fallback): derive category from workflow flags
 *    (`is_llm` → "llm", `is_custom`/`is_code`/`is_hook` → "custom").
 */
export const extractEvaluatorType = (
    evaluator: Workflow | undefined,
    lookup: Map<string, {slug: string; label: string}>,
): {slug?: string; label?: string} => {
    if (!evaluator) return {slug: undefined, label: undefined}

    // 1. Try catalog lookup by evaluator key candidates
    const candidates = collectEvaluatorCandidates(
        resolveEvaluatorKey(evaluator),
        evaluator.slug ?? undefined,
        (evaluator as any)?.key,
        (evaluator.meta as any)?.evaluator_key,
        (evaluator.meta as any)?.key,
    )

    for (const candidate of candidates) {
        const match = lookup.get(candidate)
        if (match) return match
    }

    // 2. Flag-based inference from workflow flags
    const flags = evaluator.flags
    if (flags?.is_llm) return {slug: "llm", label: "LLM"}
    if (flags?.is_custom) return {slug: "custom", label: "Custom"}
    if (flags?.is_code) return {slug: "custom", label: "Custom Code"}
    if (flags?.is_hook) return {slug: "custom", label: "Webhook"}

    return {slug: undefined, label: undefined}
}

const deriveSchemaType = (schema: unknown, depth = 0): string => {
    if (!schema || typeof schema !== "object") return "unknown"
    if (depth > 4) return "unknown"
    const node = schema as Record<string, unknown>
    const rawType = node.type
    let baseType = ""

    if (Array.isArray(rawType)) {
        baseType = rawType
            .map((item) => (typeof item === "string" ? item : "unknown"))
            .filter(Boolean)
            .join(" | ")
    } else if (typeof rawType === "string") {
        baseType = rawType
    }

    if (!baseType) {
        if (Array.isArray(node.enum)) {
            baseType = `enum(${(node.enum as unknown[]).map((entry) => String(entry)).join(", ")})`
        } else if (node.$ref && typeof node.$ref === "string") {
            baseType = `$ref:${node.$ref}`
        } else if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf)) {
            baseType = "mixed"
        } else {
            baseType = "unknown"
        }
    }

    if (baseType === "array" && node.items) {
        const itemType = deriveSchemaType(node.items, depth + 1)
        baseType = `array<${itemType}>`
    }

    if (typeof node.format === "string" && node.format.trim()) {
        baseType = `${baseType} (${node.format.trim()})`
    }

    return baseType
}

const unwrapParameterValue = (value: unknown, depth = 0): unknown => {
    if (depth > 4) return value
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    const obj = value as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(obj, "value")) {
        return unwrapParameterValue(obj.value, depth + 1)
    }
    if (Object.prototype.hasOwnProperty.call(obj, "default")) {
        return unwrapParameterValue(obj.default, depth + 1)
    }
    if (Object.prototype.hasOwnProperty.call(obj, "current")) {
        return unwrapParameterValue(obj.current, depth + 1)
    }
    return value
}

const stringifyParameterValue = (value: unknown): string | undefined => {
    if (value == null) return undefined
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    if (Array.isArray(value)) {
        const isSimple = value.every((item) => {
            const type = typeof item
            return item == null || type === "string" || type === "number" || type === "boolean"
        })
        if (isSimple) {
            return value
                .map((item) =>
                    item == null ? "null" : typeof item === "string" ? item : String(item),
                )
                .join(", ")
        }
        try {
            return JSON.stringify(value, null, 2)
        } catch {
            return undefined
        }
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        if (obj && typeof obj === "object") {
            if ("messages" in obj) return undefined
        }
        try {
            return JSON.stringify(obj, null, 2)
        } catch {
            return undefined
        }
    }
    return undefined
}

const formatParameterValue = (
    value: unknown,
): {displayValue: string; fullValue: string} | undefined => {
    const raw = stringifyParameterValue(unwrapParameterValue(value))
    if (!raw) return undefined
    const normalized = raw.trim()
    if (!normalized) return undefined
    if (normalized.length <= MAX_PARAMETER_PREVIEW_LENGTH) {
        return {displayValue: normalized, fullValue: normalized}
    }
    return {
        displayValue: `${normalized.slice(0, MAX_PARAMETER_PREVIEW_LENGTH - 1)}…`,
        fullValue: normalized,
    }
}

export const extractParameterList = (evaluator?: Workflow): ParameterPreviewItem[] => {
    if (!evaluator) return []

    const parameters = resolveParameters(evaluator.data)
    const parametersSchema = resolveParametersSchema(evaluator.data)
    const summary = new Map<string, ParameterPreviewItem>()
    const upsertParam = (key?: string | number, rawValue?: unknown, fallback = false) => {
        if (key == null) return
        const keyStr = String(key).trim()
        if (!keyStr) return
        const lookupKey = keyStr.toLowerCase()
        if (PARAMETER_KEYS_TO_IGNORE.has(lookupKey)) return

        const formatted = formatParameterValue(rawValue)
        if (!formatted) return

        if (fallback && summary.has(lookupKey)) return

        const existing = summary.get(lookupKey)
        if (existing) {
            if (!existing.displayValue) {
                summary.set(lookupKey, {
                    key: existing.key,
                    displayValue: formatted.displayValue,
                    fullValue: formatted.fullValue,
                })
            }
            return
        }

        summary.set(lookupKey, {
            key: keyStr,
            displayValue: formatted.displayValue,
            fullValue: formatted.fullValue,
        })
    }

    // Support both simple preview artifacts and workflow evaluators
    const parameterSources = [parameters, (evaluator as any)?.settings_values]

    parameterSources.forEach((source) => {
        if (!source || typeof source !== "object") return
        Object.entries(source as Record<string, unknown>).forEach(([key, value]) => {
            upsertParam(key, value)
        })
    })

    const properties = parametersSchema?.properties
    if (properties && typeof properties === "object") {
        Object.entries(properties as Record<string, unknown>).forEach(([key, value]) => {
            if (!value || typeof value !== "object") {
                upsertParam(key, value, true)
                return
            }
            const defaultValue =
                (value as any)?.default ??
                (value as any)?.value ??
                (value as any)?.example ??
                (value as any)?.placeholder
            upsertParam(key, defaultValue, true)
        })
    }

    return Array.from(summary.values())
}

export const extractModelName = (evaluator?: Workflow) => {
    if (!evaluator) return ""
    const parameters = resolveParameters(evaluator.data)
    const MODEL_KEYS = ["model", "model_name", "modelName", "llm_model", "llmModel"]

    const searchForModel = (
        value: unknown,
        visited = new WeakSet<object>(),
    ): string | undefined => {
        if (!value) return undefined
        if (typeof value === "string") return undefined
        if (Array.isArray(value)) {
            for (const entry of value) {
                const model = searchForModel(entry, visited)
                if (model) return model
            }
            return undefined
        }
        if (typeof value === "object") {
            const obj = value as Record<string, unknown>
            if (visited.has(obj)) return undefined
            visited.add(obj)
            for (const key of MODEL_KEYS) {
                const candidate = obj[key]
                if (typeof candidate === "string" && candidate.trim()) {
                    return candidate.trim()
                }
            }
            for (const child of Object.values(obj)) {
                const model = searchForModel(child, visited)
                if (model) return model
            }
        }
        return undefined
    }

    const sources = [parameters, (evaluator as any)?.settings_values, (evaluator as any)?.meta]

    for (const source of sources) {
        const model = searchForModel(source)
        if (model) return model
    }

    const agConfig = parameters?.ag_config ?? parameters?.agConfig
    if (agConfig && typeof agConfig === "object") {
        for (const cfg of Object.values(agConfig as Record<string, unknown>)) {
            const model = searchForModel(cfg)
            if (model) return model
        }
    }

    return ""
}

const parseOutputMetricsFromSchema = (schema: unknown): OutputMetric[] => {
    if (!schema || typeof schema !== "object") return []
    const node = schema as Record<string, unknown>
    if (!node.properties || typeof node.properties !== "object") return []

    const requiredList = Array.isArray(node.required)
        ? (node.required as unknown[]).map((item) => String(item))
        : []

    return Object.entries(node.properties as Record<string, unknown>)
        .map(([name, definition]) => {
            if (!definition || typeof definition !== "object") return null
            const def = definition as Record<string, unknown>
            const type = deriveSchemaType(def)
            const description =
                typeof def.description === "string" ? def.description.trim() : undefined
            return {
                name,
                type,
                required: requiredList.includes(name),
                description,
            }
        })
        .filter(Boolean) as OutputMetric[]
}

export const extractOutputMetrics = (evaluator?: Workflow): OutputMetric[] => {
    if (!evaluator) return []
    return parseOutputMetricsFromSchema(resolveOutputSchema(evaluator.data))
}

const findFirstMessages = (
    value: unknown,
    visited = new WeakSet<object>(),
): {role?: string; content?: any}[] | undefined => {
    if (!value) return undefined
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = findFirstMessages(entry, visited)
            if (found?.length) return found
        }
        return undefined
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        if (visited.has(obj)) return undefined
        visited.add(obj)
        if (Array.isArray(obj.messages)) {
            return obj.messages as {role?: string; content?: any}[]
        }
        for (const child of Object.values(obj)) {
            const found = findFirstMessages(child, visited)
            if (found?.length) return found
        }
    }
    return undefined
}

const findPromptTemplate = (
    value: unknown,
    visited = new WeakSet<object>(),
): {role?: string; content?: any}[] | undefined => {
    if (!value) return undefined

    const isPromptArray = (arr: unknown[]): arr is {role?: string; content?: any}[] =>
        arr.every(
            (entry) =>
                entry &&
                typeof entry === "object" &&
                typeof (entry as any).role === "string" &&
                ((typeof (entry as any).content === "string" &&
                    (entry as any).content.trim() !== "") ||
                    Array.isArray((entry as any).content)),
        )

    if (Array.isArray(value)) {
        if (isPromptArray(value)) return value
        for (const entry of value) {
            const found = findPromptTemplate(entry, visited)
            if (found?.length) return found
        }
        return undefined
    }

    if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        if (visited.has(obj)) return undefined
        visited.add(obj)

        const direct = obj.prompt_template
        if (Array.isArray(direct) && isPromptArray(direct)) {
            return direct
        }

        for (const child of Object.values(obj)) {
            const found = findPromptTemplate(child, visited)
            if (found?.length) return found
        }
    }

    return undefined
}

export const extractImageAttachment = (
    segment: Record<string, unknown>,
): PromptPreviewAttachment | null => {
    const rawImage = segment.image_url ?? segment.imageUrl
    const type = typeof segment.type === "string" ? segment.type.toLowerCase() : undefined

    if (typeof rawImage === "string" && rawImage.trim()) {
        return {
            type: "image",
            url: rawImage.trim(),
            alt: typeof segment.alt === "string" ? segment.alt : undefined,
        }
    }

    if (rawImage && typeof rawImage === "object") {
        const url =
            (rawImage as any)?.url ?? (rawImage as any)?.signed_url ?? (rawImage as any)?.href
        if (typeof url === "string" && url.trim()) {
            return {
                type: "image",
                url: url.trim(),
                alt:
                    typeof (rawImage as any)?.detail === "string"
                        ? (rawImage as any)?.detail
                        : typeof (rawImage as any)?.alt === "string"
                          ? (rawImage as any)?.alt
                          : type === "image_url" && typeof segment.text === "string"
                            ? segment.text
                            : undefined,
            }
        }

        const data = (rawImage as any)?.data
        if (data && typeof data === "object") {
            const nestedUrl =
                (data as any)?.url ?? (data as any)?.signed_url ?? (data as any)?.href ?? undefined
            if (typeof nestedUrl === "string" && nestedUrl.trim()) {
                return {
                    type: "image",
                    url: nestedUrl.trim(),
                    alt:
                        typeof (data as any)?.detail === "string"
                            ? (data as any)?.detail
                            : typeof (data as any)?.alt === "string"
                              ? (data as any)?.alt
                              : undefined,
                }
            }
        }
    }

    if (type === "image_url" && typeof segment.text === "string" && segment.text.trim()) {
        return {
            type: "image",
            url: segment.text.trim(),
            alt: typeof segment.alt === "string" ? segment.alt : undefined,
        }
    }

    return null
}

const normalizeMessageContent = (
    rawContent: unknown,
): {text: string; attachments: PromptPreviewAttachment[]} => {
    const textSegments: string[] = []
    const attachments: PromptPreviewAttachment[] = []

    const pushText = (value?: string) => {
        if (!value) return
        const normalized = value.trim()
        if (!normalized) return
        textSegments.push(normalized)
    }

    const pushAttachment = (maybeAttachment: PromptPreviewAttachment | null | undefined) => {
        if (!maybeAttachment) return
        attachments.push(maybeAttachment)
    }

    const visit = (value: unknown, nested = false) => {
        if (value == null) return
        if (typeof value === "string") {
            pushText(value)
            return
        }
        if (typeof value === "number" || typeof value === "boolean") {
            pushText(String(value))
            return
        }
        if (Array.isArray(value)) {
            value.forEach((entry) => visit(entry, true))
            return
        }
        if (typeof value === "object") {
            const obj = value as Record<string, unknown>
            if (!nested && typeof obj.type === "string") {
                const type = obj.type.toLowerCase()
                if (type === "image_url") {
                    pushAttachment(extractImageAttachment(obj))
                    return
                }
                if (type === "text") {
                    if (typeof obj.text === "string") pushText(obj.text)
                    return
                }
            }

            if (typeof obj.content === "string") {
                pushText(obj.content)
            } else if (Array.isArray(obj.content)) {
                obj.content.forEach((entry) => visit(entry, true))
            }

            if (typeof obj.text === "string") {
                pushText(obj.text)
            }

            if (Array.isArray(obj.parts)) {
                obj.parts.forEach((part) => visit(part))
            }

            pushAttachment(extractImageAttachment(obj))
        }
    }

    visit(rawContent)

    let text = textSegments.join("\n\n").trim()

    if (!text) {
        if (typeof rawContent === "string") {
            text = rawContent.trim()
        } else if (rawContent && typeof rawContent === "object") {
            try {
                text = JSON.stringify(rawContent, null, 2)
            } catch {
                text = ""
            }
        } else if (rawContent != null) {
            text = String(rawContent)
        }
    }

    return {text, attachments}
}

export const extractPromptSections = (evaluator?: Workflow): PromptPreviewSection[] => {
    if (!evaluator) return []
    const data = (evaluator as any)?.data ?? {}
    const parameters = resolveParameters(data)
    const settings = parameters ?? (evaluator as any)?.settings_values
    const agConfig = parameters?.ag_config ?? parameters?.agConfig
    const messages = findFirstMessages(settings) ?? findFirstMessages(agConfig)

    if (messages?.length) {
        return messages
            .map((msg, index) => {
                const label = capitalize(msg?.role) ?? `Message ${index + 1}`
                const rawContent = msg?.content
                const {text, attachments} = normalizeMessageContent(rawContent)
                return {
                    id: ((msg as any)?.id ?? (msg as any)?.__id ?? `${label}-${index}`).toString(),
                    label,
                    role: typeof msg?.role === "string" ? msg.role : undefined,
                    content: text.trim(),
                    attachments,
                }
            })
            .filter((section) => section.content || section.attachments.length > 0)
    }

    const promptTemplate = findPromptTemplate(settings) ?? findPromptTemplate(parameters)

    if (promptTemplate?.length) {
        return promptTemplate
            .map((item, index) => {
                const label = capitalize(item?.role) ?? `Message ${index + 1}`
                const rawContent = item?.content
                const {text, attachments} = normalizeMessageContent(rawContent)
                return {
                    id: (
                        (item as any)?.id ??
                        (item as any)?.__id ??
                        `${label}-${index}`
                    ).toString(),
                    label,
                    role: typeof item?.role === "string" ? item.role : undefined,
                    content: text.trim(),
                    attachments,
                }
            })
            .filter((section) => section.content || section.attachments.length > 0)
    }

    const directScript = resolveScript(data)
    if (typeof directScript === "string" && directScript.trim()) {
        return [
            {
                id: "script",
                label: "Script",
                role: undefined,
                content: directScript,
                attachments: [],
            },
        ]
    }

    const promptSources = [settings]

    const extractPromptFromValue = (value: unknown): string | undefined => {
        if (typeof value === "string") return value.trim()
        if (Array.isArray(value)) {
            const text = value
                .map((entry) => {
                    if (typeof entry === "string") return entry.trim()
                    const result = normalizeMessageContent(entry)
                    return result.text
                })
                .filter(Boolean)
                .join("\n")
                .trim()
            return text || undefined
        }
        if (value && typeof value === "object") {
            const unwrapped = unwrapParameterValue(value)
            if (typeof unwrapped === "string") return unwrapped.trim()
            if (Array.isArray(unwrapped)) return extractPromptFromValue(unwrapped)
            if (unwrapped && typeof unwrapped === "object") {
                const normalized = normalizeMessageContent(unwrapped)
                return normalized.text.trim() || undefined
            }
        }
        return undefined
    }

    for (const source of promptSources) {
        if (!source || typeof source !== "object") continue
        for (const [rawKey, rawValue] of Object.entries(source as Record<string, unknown>)) {
            const normalizedKey = rawKey.toLowerCase()
            if (!PROMPT_KEY_LOOKUP.has(normalizedKey)) continue
            const prompt = extractPromptFromValue(rawValue)
            if (prompt) {
                return [
                    {
                        id: "prompt",
                        label: "Prompt",
                        role: undefined,
                        content: prompt,
                        attachments: [],
                    },
                ]
            }
        }
    }

    return []
}
