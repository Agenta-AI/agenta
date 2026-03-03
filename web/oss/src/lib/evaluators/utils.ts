import type {Evaluator, SimpleEvaluator, SimpleEvaluatorData} from "@/oss/lib/Types"

const normalizeSlugBase = (value?: string | null) =>
    String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

const trimVersionSuffix = (value: string) => value.replace(/-v\d+$/i, "")

const OUTPUT_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema"

const isPlainObject = (value: unknown): value is Record<string, any> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeFieldNames = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []

    return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
}

export const buildJsonMultiFieldMatchOutputsSchema = (fields: unknown): Record<string, any> => {
    const dynamicFields = normalizeFieldNames(fields)
    const properties: Record<string, any> = {aggregate_score: {type: "number"}}

    dynamicFields.forEach((field) => {
        properties[field] = {type: "number"}
    })

    return {
        $schema: OUTPUT_SCHEMA_DRAFT,
        type: "object",
        properties,
        required: ["aggregate_score"],
        additionalProperties: false,
    }
}

export const deriveEvaluatorOutputsSchema = ({
    evaluatorKey,
    evaluatorTemplate,
    parameters,
}: {
    evaluatorKey?: string | null
    evaluatorTemplate?: Partial<Evaluator> | null
    parameters?: Record<string, any> | null
}): Record<string, any> | undefined => {
    const defaultOutputsSchema = evaluatorTemplate?.outputs_schema

    if (evaluatorKey === "auto_ai_critique") {
        const jsonSchema = parameters?.json_schema
        if (isPlainObject(jsonSchema) && isPlainObject(jsonSchema.schema)) {
            return jsonSchema.schema
        }

        return isPlainObject(defaultOutputsSchema) ? defaultOutputsSchema : undefined
    }

    if (evaluatorKey === "json_multi_field_match") {
        return buildJsonMultiFieldMatchOutputsSchema(parameters?.fields)
    }

    return isPlainObject(defaultOutputsSchema) ? defaultOutputsSchema : undefined
}

export const extractEvaluatorKeyFromUri = (uri?: string | null): string | undefined => {
    if (!uri) return undefined
    const trimmed = uri.trim()
    if (!trimmed) return undefined

    const builtinMatch = trimmed.match(/^agenta:builtin:([^:]+)(:|$)/i)
    if (builtinMatch?.[1]) {
        return trimVersionSuffix(builtinMatch[1])
    }

    const parts = trimmed.split(":").filter(Boolean)
    if (parts.length >= 3 && parts[2]) {
        return trimVersionSuffix(parts[2])
    }

    const slashParts = trimmed.split("/").filter(Boolean)
    const lastSegment = slashParts[slashParts.length - 1]
    if (lastSegment) {
        return trimVersionSuffix(lastSegment)
    }

    return undefined
}

export const resolveEvaluatorKey = (
    evaluator?: Partial<SimpleEvaluator> | null,
): string | undefined => {
    if (!evaluator) return undefined

    const candidate =
        extractEvaluatorKeyFromUri(evaluator.data?.uri) ||
        (typeof (evaluator as any)?.evaluator_key === "string"
            ? (evaluator as any).evaluator_key
            : undefined) ||
        (typeof evaluator.meta?.evaluator_key === "string"
            ? evaluator.meta.evaluator_key
            : undefined) ||
        (typeof evaluator.flags?.evaluator_key === "string"
            ? evaluator.flags.evaluator_key
            : undefined) ||
        (typeof (evaluator as any)?.key === "string" ? (evaluator as any).key : undefined)

    return candidate ? String(candidate).trim() : undefined
}

export const buildEvaluatorUri = (evaluatorKey: string, version = "v0") =>
    `agenta:builtin:${evaluatorKey}:${version}`

export const buildEvaluatorSlug = (name?: string | null) => {
    const base = normalizeSlugBase(name) || "evaluator"
    const suffix = Math.random().toString(36).slice(2, 8)
    const maxBaseLength = Math.max(1, 50 - suffix.length - 1)
    const trimmedBase = base.slice(0, maxBaseLength)
    return `${trimmedBase}-${suffix}`
}

export const mergeEvaluatorData = (
    base?: SimpleEvaluatorData | null,
    updates?: Partial<SimpleEvaluatorData> | null,
): SimpleEvaluatorData | undefined => {
    if (!base && !updates) return undefined
    return {
        ...(base ?? {}),
        ...(updates ?? {}),
    }
}

export const getEvaluatorParameters = (evaluator?: Partial<SimpleEvaluator> | null) =>
    (evaluator?.data?.parameters as Record<string, any>) || {}
