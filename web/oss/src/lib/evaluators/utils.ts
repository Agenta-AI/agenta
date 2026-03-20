import type {Workflow} from "@agenta/entities/workflow"

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

/**
 * Resolve the evaluator key from a workflow entity.
 * Tries URI parsing first, then falls back to metadata fields.
 */
export const resolveEvaluatorKey = (evaluator?: Partial<Workflow> | null): string | undefined => {
    if (!evaluator) return undefined

    const data = evaluator.data as Record<string, unknown> | undefined
    const meta = evaluator.meta as Record<string, unknown> | undefined
    const flags = evaluator.flags as Record<string, unknown> | undefined

    const candidate =
        extractEvaluatorKeyFromUri(data?.uri as string | undefined) ||
        (typeof (evaluator as any)?.evaluator_key === "string"
            ? (evaluator as any).evaluator_key
            : undefined) ||
        (typeof meta?.evaluator_key === "string" ? meta.evaluator_key : undefined) ||
        (typeof flags?.evaluator_key === "string" ? flags.evaluator_key : undefined) ||
        (typeof (evaluator as any)?.key === "string" ? (evaluator as any).key : undefined)

    return candidate ? String(candidate).trim() : undefined
}

export const buildEvaluatorSlug = (name?: string | null) => {
    const base = normalizeSlugBase(name) || "evaluator"
    const suffix = Math.random().toString(36).slice(2, 8)
    const maxBaseLength = Math.max(1, 50 - suffix.length - 1)
    const trimmedBase = base.slice(0, maxBaseLength)
    return `${trimmedBase}-${suffix}`
}

export const getEvaluatorParameters = (evaluator?: Partial<Workflow> | null) =>
    (evaluator?.data?.parameters as Record<string, any>) || {}
