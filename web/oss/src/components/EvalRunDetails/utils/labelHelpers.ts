import type {EvaluationTableColumnGroup} from "../atoms/table/types"

export const titleize = (value: string) =>
    value
        .replace(/[_\-.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())

const HEX_SUFFIX_REGEX = /-[0-9a-f]{6,}$/i
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f-]{13,}$/i
const HEX_STRING_REGEX = /^[0-9a-f]{8,}$/i

const shortenIdentifier = (value: string): string => {
    if (value.length <= 12) return value
    return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export const humanizeIdentifier = (source?: unknown): string | undefined => {
    if (source === undefined || source === null) return undefined
    const value = String(source).trim()
    if (!value) return undefined

    if (UUID_REGEX.test(value)) {
        return shortenIdentifier(value)
    }

    if (HEX_STRING_REGEX.test(value)) {
        return shortenIdentifier(value)
    }

    if (HEX_SUFFIX_REGEX.test(value)) {
        const stripped = value.replace(HEX_SUFFIX_REGEX, "")
        if (stripped.length >= 3) {
            return stripped
        }
    }

    return value
}

export const humanizeStepKey = (key?: string, fallback?: string): string => {
    const candidate = humanizeIdentifier(key) ?? fallback ?? ""
    if (!candidate) return ""
    return titleize(candidate.replace(/[_\s]+/g, " "))
}

export const formatReferenceLabel = (
    ref: Record<string, any> | undefined,
    fallback?: string,
): string | undefined => {
    if (!ref) return fallback

    const candidate =
        ref.displayName ??
        ref.display_name ??
        ref.name ??
        ref.title ??
        ref.slug ??
        ref.id ??
        ref.version ??
        fallback

    const label = humanizeIdentifier(candidate)
    return label ?? fallback
}

export const resolveGroupLabel = (group: EvaluationTableColumnGroup): string | undefined => {
    const meta = group.meta ?? {}
    const refs = (meta.refs ?? {}) as Record<string, any>
    const stepRole = (meta.stepRole as string | undefined) ?? (group.kind as string | undefined)

    if (stepRole === "input") {
        const testsetName =
            humanizeIdentifier(refs.testset?.name) ??
            humanizeIdentifier(refs.testset?.slug) ??
            formatReferenceLabel(refs.testset)
        if (testsetName) {
            return `Testset ${testsetName}`
        }

        const queryLabel =
            formatReferenceLabel(refs.query) ?? formatReferenceLabel(refs.query_revision)
        if (queryLabel) {
            return `Query ${queryLabel}`
        }
    }

    if (stepRole === "invocation") {
        const applicationLabel =
            humanizeIdentifier(refs.application?.name) ??
            humanizeIdentifier(refs.application?.slug) ??
            formatReferenceLabel(refs.application) ??
            formatReferenceLabel(refs.agent) ??
            formatReferenceLabel(refs.tool)
        const variantLabel =
            humanizeIdentifier(refs.application_variant?.name) ??
            humanizeIdentifier(refs.variant?.name) ??
            formatReferenceLabel(refs.application_variant) ??
            formatReferenceLabel(refs.variant)

        const revisionVersion =
            refs.application_revision?.version ?? refs.application_revision?.revision ?? null

        const parts = []
        if (applicationLabel) parts.push(`Application ${applicationLabel}`)
        if (variantLabel && variantLabel !== applicationLabel) parts.push(`Variant ${variantLabel}`)
        if (revisionVersion) parts.push(`Rev ${revisionVersion}`)
        if (parts.length) return parts.join(" · ")
    }

    return group.label || humanizeStepKey(group.id, group.kind)
}
