import {
    PromptPreviewAttachment,
    PromptPreviewSection,
} from "@/oss/components/pages/evaluations/onlineEvaluation/types"
import type {QueryWindowingPayload} from "@/oss/services/onlineEvaluations/api"

export interface StepMeta {
    key?: string | null
    refs?: Record<string, any> | null
}

export const deriveRunTags = (primary: unknown, secondary: unknown): string[] => {
    const result = new Set<string>()
    const append = (source: unknown) => {
        if (!source) return
        if (Array.isArray(source)) {
            source.forEach((entry) => {
                const value = toDisplayable(entry)
                if (value) result.add(value)
            })
            return
        }
        if (typeof source === "object") {
            Object.entries(source as Record<string, unknown>).forEach(([key, value]) => {
                if (value === true || value === null || value === undefined || value === "") {
                    const label = toDisplayable(key)
                    if (label) result.add(label)
                } else {
                    const label = `${key}: ${toDisplayable(value) ?? ""}`.trim()
                    if (label) result.add(label)
                }
            })
            return
        }
        const label = toDisplayable(source)
        if (label) result.add(label)
    }
    append(primary)
    append(secondary)
    return Array.from(result)
}

export const toDisplayable = (value: unknown): string | null => {
    if (value === null || value === undefined) return null
    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed ? trimmed : null
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

export const hasQueryReference = (reference: Record<string, unknown>): boolean =>
    Boolean(
        reference &&
            (reference.queryId ||
                reference.querySlug ||
                reference.queryRevisionId ||
                reference.queryRevisionSlug ||
                reference.queryVariantId ||
                reference.queryVariantSlug),
    )

export const formatSamplingRate = (rate: unknown): string => {
    if (typeof rate !== "number" || Number.isNaN(rate)) {
        return "—"
    }
    if (rate >= 0 && rate <= 1) {
        return `${Math.round(rate * 100)}%`
    }
    return `${Math.round(rate)}%`
}

export const formatWindowRange = (windowing?: QueryWindowingPayload | null): string => {
    if (!windowing) return "—"

    const oldest = toDate(windowing.oldest)
    const newest = toDate(windowing.newest)

    if (oldest && newest) {
        const diffDays = Math.max(
            Math.floor((newest.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24)),
            0,
        )
        if (diffDays > 0 && diffDays <= 31) {
            return `Last ${diffDays} day${diffDays === 1 ? "" : "s"}`
        }
        return `${formatDate(oldest)} – ${formatDate(newest)}`
    }

    if (newest) {
        return `Up to ${formatDate(newest)}`
    }

    if (oldest) {
        return `Since ${formatDate(oldest)}`
    }

    return "Not specified"
}

const toDate = (value: unknown): Date | null => {
    if (typeof value !== "string") return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

const formatDate = (date: Date): string =>
    new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(date)

export const formatNumericValue = (value: unknown): string => {
    if (typeof value === "number" && !Number.isNaN(value)) {
        return value.toLocaleString()
    }
    return "—"
}

export const formatTextValue = (value: unknown): string => {
    if (typeof value !== "string") return "—"
    const trimmed = value.trim()
    if (!trimmed) return "—"
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export const stringifyError = (error: unknown): string => {
    if (!error) return "Unknown error"
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    try {
        return JSON.stringify(error)
    } catch {
        return String(error)
    }
}

export const toIdString = (value: unknown): string | null => {
    if (typeof value === "string") return value
    if (typeof value === "number") return String(value)
    return null
}

const MAX_PROMPT_DEPTH = 5

const isPlainObject = (value: unknown): value is Record<string, any> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)

const isMessageEntry = (value: any) =>
    value && typeof value === "object" && (value.role || value.content)

const arrayIsMessageLike = (value: any[]): boolean =>
    value.length > 0 && value.every((entry) => isMessageEntry(entry))

const normalizePromptText = (
    raw: unknown,
): {text: string; attachments: PromptPreviewAttachment[]} => {
    const attachments: PromptPreviewAttachment[] = []

    const extractAttachments = (value: any) => {
        if (!value || typeof value !== "object") return
        const list = Array.isArray(value.attachments) ? value.attachments : value.attachment
        if (Array.isArray(list)) {
            list.forEach((item: any, index) => {
                if (item && typeof item === "object" && typeof item.url === "string") {
                    attachments.push({
                        id: (item.id ?? `${index}`) as string,
                        url: item.url,
                        alt: typeof item.alt === "string" ? item.alt : undefined,
                    })
                }
            })
        }
    }

    const renderText = (value: unknown): string => {
        if (typeof value === "string") return value.trim()
        if (Array.isArray(value)) {
            const parts = value
                .map((entry) => {
                    if (typeof entry === "string") return entry.trim()
                    if (entry && typeof entry === "object") {
                        extractAttachments(entry)
                        if (typeof entry.text === "string") return entry.text.trim()
                        if (typeof entry.content === "string") return entry.content.trim()
                        try {
                            return JSON.stringify(entry, null, 2)
                        } catch {
                            return ""
                        }
                    }
                    return entry != null ? String(entry) : ""
                })
                .filter(Boolean)
            return parts.join("\n").trim()
        }
        if (value && typeof value === "object") {
            extractAttachments(value)
            if (typeof (value as any).text === "string") return (value as any).text.trim()
            if (typeof (value as any).content === "string") return (value as any).content.trim()
            try {
                return JSON.stringify(value, null, 2)
            } catch {
                return ""
            }
        }
        if (value === null || value === undefined) return ""
        return String(value)
    }

    return {text: renderText(raw), attachments}
}

const findMessagesInValue = (value: unknown, visited: Set<unknown>, depth = 0): any[] | null => {
    if (!value || depth > MAX_PROMPT_DEPTH) return null
    if (visited.has(value)) return null
    if (typeof value === "object") visited.add(value)

    if (Array.isArray(value)) {
        if (arrayIsMessageLike(value)) return value
        for (const entry of value) {
            const found = findMessagesInValue(entry, visited, depth + 1)
            if (found) return found
        }
        return null
    }

    if (isPlainObject(value)) {
        if (Array.isArray(value.messages) && value.messages.length) {
            if (arrayIsMessageLike(value.messages)) return value.messages
        }
        if (Array.isArray((value as any).prompt) && (value as any).prompt.length) {
            if (arrayIsMessageLike((value as any).prompt)) return (value as any).prompt
        }
        if (Array.isArray((value as any).promptTemplate) && (value as any).promptTemplate.length) {
            if (arrayIsMessageLike((value as any).promptTemplate))
                return (value as any).promptTemplate
        }
        if (
            Array.isArray((value as any).prompt_template) &&
            (value as any).prompt_template.length
        ) {
            if (arrayIsMessageLike((value as any).prompt_template))
                return (value as any).prompt_template
        }

        for (const key of Object.keys(value)) {
            const found = findMessagesInValue((value as any)[key], visited, depth + 1)
            if (found) return found
        }
    }

    return null
}

const capitalize = (value?: string | null) => {
    if (!value) return ""
    const trimmed = value.trim()
    if (!trimmed) return ""
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export const extractPromptSectionsFromVariantParams = (
    params: Record<string, any> | null | undefined,
): PromptPreviewSection[] => {
    if (!params || typeof params !== "object") return []

    const candidates = [
        params,
        params.ag_config,
        params.agConfig,
        params.parameters,
        params.configuration,
        params.prompt_template,
        params.promptTemplate,
    ]

    const visited = new Set<unknown>()
    let messages: any[] | null = null
    for (const candidate of candidates) {
        messages = findMessagesInValue(candidate, visited, 0)
        if (messages) break
    }

    if (!messages || !messages.length) {
        return []
    }

    return messages
        .map((message, index) => {
            const label = capitalize(message?.role) || `Message ${index + 1}`
            const {text, attachments} = normalizePromptText(message?.content ?? message)
            const trimmed = text.trim()
            if (!trimmed && attachments.length === 0) {
                return null
            }
            return {
                id: (message?.id ?? message?.__id ?? `${label}-${index}`).toString(),
                label,
                role: typeof message?.role === "string" ? message.role : undefined,
                content: trimmed,
                attachments,
            }
        })
        .filter((section): section is PromptPreviewSection => Boolean(section))
}

const MODEL_KEYS = ["model", "model_name", "modelName", "engine", "deployment", "provider"]

const findModelInValue = (value: unknown, visited: Set<unknown>, depth = 0): string | null => {
    if (!value || depth > MAX_PROMPT_DEPTH) return null
    if (visited.has(value)) return null
    if (typeof value === "object") visited.add(value)

    if (typeof value === "string") {
        return value.trim() || null
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            const result = findModelInValue(entry, visited, depth + 1)
            if (result) return result
        }
        return null
    }

    if (isPlainObject(value)) {
        for (const key of MODEL_KEYS) {
            const candidate = (value as any)[key]
            if (typeof candidate === "string" && candidate.trim()) {
                return candidate.trim()
            }
        }

        if (Array.isArray((value as any).llm_config?.model_history)) {
            const history = (value as any).llm_config.model_history
            const last = history[history.length - 1]
            const result = findModelInValue(last, visited, depth + 1)
            if (result) return result
        }

        if ((value as any).llm_config?.model) {
            const result = findModelInValue((value as any).llm_config.model, visited, depth + 1)
            if (result) return result
        }

        for (const key of Object.keys(value)) {
            const result = findModelInValue((value as any)[key], visited, depth + 1)
            if (result) return result
        }
    }

    return null
}

export const extractModelLabelFromVariantParams = (
    params: Record<string, any> | null | undefined,
): string | null => {
    if (!params || typeof params !== "object") return null
    const visited = new Set<unknown>()
    return findModelInValue(params, visited, 0)
}

const LLM_SETTING_LABELS: Record<string, string> = {
    temperature: "Temperature",
    top_p: "Top P",
    topP: "Top P",
    top_k: "Top K",
    topK: "Top K",
    max_tokens: "Max tokens",
    maxTokens: "Max tokens",
    presence_penalty: "Presence penalty",
    presencePenalty: "Presence penalty",
    frequency_penalty: "Frequency penalty",
    frequencyPenalty: "Frequency penalty",
}

export interface LLMSettingEntry {
    label: string
    value: string
}

const formatSettingValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (typeof value === "number") {
        if (Number.isInteger(value)) return value.toString()
        return Number(value.toFixed(3)).toString()
    }
    if (typeof value === "boolean") return value ? "true" : "false"
    return String(value)
}

export const extractLLMSettingsFromVariantParams = (
    params: Record<string, any> | null | undefined,
): LLMSettingEntry[] => {
    if (!params || typeof params !== "object") return []

    const visited = new Set<unknown>()
    const entries = new Map<string, string>()

    const walk = (value: unknown, depth: number) => {
        if (!value || depth > MAX_PROMPT_DEPTH) return
        if (visited.has(value)) return
        if (typeof value === "object") visited.add(value)

        if (Array.isArray(value)) {
            value.forEach((entry) => walk(entry, depth + 1))
            return
        }

        if (isPlainObject(value)) {
            Object.entries(LLM_SETTING_LABELS).forEach(([rawKey, label]) => {
                const settingValue = (value as Record<string, any>)[rawKey]
                if (settingValue !== undefined && settingValue !== null && !entries.has(label)) {
                    entries.set(label, formatSettingValue(settingValue))
                }
            })

            const llmConfig =
                (value as any).llm_config ??
                (value as any).llmConfig ??
                (value as any).llm ??
                (value as any).service?.llm_config ??
                (value as any).service?.llmConfig
            if (llmConfig && typeof llmConfig === "object") {
                walk(llmConfig, depth + 1)
            }

            Object.keys(value).forEach((key) => {
                if (key === "llm_config" || key === "llmConfig" || key === "llm") return
                walk((value as any)[key], depth + 1)
            })
        }
    }

    walk(params, 0)

    return Array.from(entries.entries()).map(([label, value]) => ({label, value}))
}

const RESPONSE_FORMAT_KEYS = ["response_format", "responseFormat"]

const formatResponseFormat = (value: any): string | null => {
    if (!value || typeof value !== "object") return null
    const type =
        value.type ??
        value.response_type ??
        value.responseType ??
        value.mode ??
        value.format ??
        null
    if (typeof type === "string") {
        const normalized = type.trim().toLowerCase()
        if (normalized === "text" || normalized === "") return "Text"
        if (normalized === "json" || normalized === "json_object") return "JSON object"
        if (normalized === "json_schema") return "JSON schema"
        if (normalized === "json_array") return "JSON array"
        return type
    }
    return null
}

export const extractResponseFormatFromVariantParams = (
    params: Record<string, any> | null | undefined,
): string | null => {
    if (!params || typeof params !== "object") return null
    const visited = new Set<unknown>()

    const walk = (value: unknown, depth: number): string | null => {
        if (!value || depth > MAX_PROMPT_DEPTH) return null
        if (visited.has(value)) return null
        if (typeof value === "object") visited.add(value)

        if (Array.isArray(value)) {
            for (const entry of value) {
                const result = walk(entry, depth + 1)
                if (result) return result
            }
            return null
        }

        if (isPlainObject(value)) {
            for (const key of RESPONSE_FORMAT_KEYS) {
                if (value[key]) {
                    const formatted = formatResponseFormat(value[key])
                    if (formatted) return formatted
                }
            }

            if (value.llm_config || value.llmConfig) {
                const result = walk(value.llm_config ?? value.llmConfig, depth + 1)
                if (result) return result
            }

            if (value.response_format || value.responseFormat) {
                const formatted = formatResponseFormat(
                    value.response_format ?? value.responseFormat,
                )
                if (formatted) return formatted
            }

            for (const key of Object.keys(value)) {
                const result = walk((value as any)[key], depth + 1)
                if (result) return result
            }
        }

        return null
    }

    return walk(params, 0)
}

export interface TestsetRefMeta {
    id: string
}
