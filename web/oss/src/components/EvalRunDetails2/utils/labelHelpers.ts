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
