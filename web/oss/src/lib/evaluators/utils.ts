import type {SimpleEvaluator, SimpleEvaluatorData} from "@/oss/lib/Types"

const normalizeSlugBase = (value?: string | null) =>
    String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

const trimVersionSuffix = (value: string) => value.replace(/-v\d+$/i, "")

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
