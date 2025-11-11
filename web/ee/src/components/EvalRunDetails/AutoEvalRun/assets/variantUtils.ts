export const normalizeId = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined
    const stringValue = String(value)
    if (
        stringValue.trim() === "" ||
        stringValue === "undefined" ||
        stringValue === "null" ||
        stringValue === "[object Object]" ||
        stringValue === "NaN"
    ) {
        return undefined
    }
    return stringValue
}

export const normalizeLabel = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

export interface VariantDisplayOptions {
    fallbackLabel?: string
    fallbackRevisionId?: string
    /** When true (default), navigation requires a runtime endpoint */
    requireRuntime?: boolean
}

export interface VariantDisplayMetadata {
    label: string
    revisionId: string
    isHealthy: boolean
    hasRuntime: boolean
    canNavigate: boolean
}

export const getVariantDisplayMetadata = (
    variant: any,
    {fallbackLabel, fallbackRevisionId, requireRuntime = true}: VariantDisplayOptions = {},
): VariantDisplayMetadata => {
    const label =
        normalizeLabel(variant?.variantName) ??
        normalizeLabel(variant?.configName) ??
        normalizeLabel(variant?.name) ??
        normalizeLabel(variant?.variantId) ??
        normalizeLabel(fallbackLabel) ??
        "Variant unavailable"

    const revisionId =
        normalizeId(variant?._revisionId) ??
        normalizeId(variant?.id) ??
        normalizeId(variant?.variantId) ??
        normalizeId(variant?.revisionId) ??
        normalizeId(fallbackRevisionId) ??
        ""

    const hasRuntime = Boolean(
        variant?.uri ||
            variant?.uriObject?.runtimePrefix ||
            variant?.runtime?.uri ||
            variant?.runtime?.runtimePrefix,
    )
    const isHealthy = variant?.appStatus !== false

    const canNavigate = Boolean(revisionId) && isHealthy && (requireRuntime ? hasRuntime : true)

    return {
        label,
        revisionId,
        isHealthy,
        hasRuntime,
        canNavigate,
    }
}

const HEX_SEGMENT_REGEX = /^[0-9a-f]{8,}$/i

export const prettifyVariantLabel = (label?: string): string | undefined => {
    if (!label) return label
    const parts = label.split("-")
    if (parts.length <= 1) {
        return label
    }

    const last = parts[parts.length - 1]
    if (HEX_SEGMENT_REGEX.test(last)) {
        return parts.slice(0, -1).join("-")
    }

    return label
}

export const deriveVariantLabelParts = ({
    variant,
    displayLabel,
}: {
    variant?: any
    displayLabel?: string
}): {label: string; revision?: string} => {
    const normalizedVariantLabel =
        normalizeLabel(variant?.variantName) ??
        normalizeLabel(variant?.configName) ??
        normalizeLabel(variant?.name) ??
        undefined

    const normalizedVariantId = normalizeLabel(variant?.variantId)

    const rawLabel = normalizedVariantLabel ?? normalizedVariantId ?? displayLabel ?? "Variant"
    const trimmed = prettifyVariantLabel(rawLabel) ?? rawLabel

    const primaryRevision =
        variant?.revision ??
        variant?.revisionLabel ??
        variant?.version ??
        variant?._revision ??
        undefined

    if (
        primaryRevision !== undefined &&
        primaryRevision !== null &&
        String(primaryRevision).toString().trim() !== ""
    ) {
        return {label: trimmed, revision: String(primaryRevision)}
    }

    const segments = trimmed.split("-")
    if (segments.length > 1) {
        const last = segments[segments.length - 1]
        if (/^\d+$/.test(last)) {
            const base = segments.slice(0, -1).join("-") || segments.join("-")
            return {label: base, revision: last}
        }
    }

    return {label: trimmed, revision: undefined}
}

export const deriveVariantAppName = ({
    variant,
    fallbackAppName,
}: {
    variant?: any
    fallbackAppName?: string
}): string | undefined => {
    return (
        normalizeLabel(variant?.appName) ??
        normalizeLabel(variant?.application?.name) ??
        normalizeLabel(variant?.application?.appName) ??
        normalizeLabel(variant?.application_ref?.name) ??
        normalizeLabel(variant?.applicationRef?.name) ??
        normalizeLabel(fallbackAppName)
    )
}

export const combineAppNameWithLabel = (appName: string | undefined, label?: string): string => {
    const normalizedLabel = label?.trim()
    const normalizedApp = normalizeLabel(appName)

    if (!normalizedLabel || normalizedLabel.length === 0) {
        return normalizedApp ?? "Variant unavailable"
    }

    if (!normalizedApp) {
        return normalizedLabel
    }

    return normalizedLabel.toLowerCase().startsWith(normalizedApp.toLowerCase())
        ? normalizedLabel
        : `${normalizedApp} ${normalizedLabel}`
}
