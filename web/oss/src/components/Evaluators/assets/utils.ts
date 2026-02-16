import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {capitalize} from "@/oss/lib/helpers/utils"
import {Evaluator, EvaluatorConfig} from "@/oss/lib/Types"

import {
    EvaluatorCategory,
    EvaluatorPreview,
    EvaluatorRegistryRow,
    EvaluatorTypeBadge,
    EvaluatorConfigRow,
} from "./types"

const createTypeLabel = (slug?: string, fallback?: string) => {
    if (slug) {
        return capitalize(slug.replace(/[_-]+/g, " "))
    }
    if (fallback) {
        return capitalize(fallback)
    }
    return ""
}

const sanitizeVersion = (value?: string | null) => {
    if (!value) return ""
    const trimmed = value.trim()
    if (!trimmed) return ""
    return /^v/i.test(trimmed) ? trimmed : `v${trimmed}`
}

const collectPreviewTags = (evaluator: EvaluatorPreview) => {
    const tags = new Set<string>()

    const metaTags = (evaluator.meta as any)?.tags
    if (Array.isArray(metaTags)) {
        metaTags.filter(Boolean).forEach((tag) => tags.add(String(tag)))
    }

    const flagTags = (evaluator.flags as any)?.tags
    if (Array.isArray(flagTags)) {
        flagTags.filter(Boolean).forEach((tag) => tags.add(String(tag)))
    }

    if (evaluator.metrics && typeof evaluator.metrics === "object") {
        Object.keys(evaluator.metrics)
            .filter(Boolean)
            .forEach((metric) => tags.add(metric))
    }

    return Array.from(tags)
}

const formatDate = (value?: string) => {
    if (!value) return ""
    return formatDay({date: value})
}

const collectConfigTags = (config: EvaluatorConfig, evaluator?: Evaluator | null) => {
    const tags = new Set<string>()

    if (Array.isArray(config.tags)) {
        config.tags.filter(Boolean).forEach((tag) => tags.add(String(tag)))
    }

    if (evaluator && Array.isArray(evaluator.tags)) {
        evaluator.tags.filter(Boolean).forEach((tag) => tags.add(String(tag)))
    }

    return Array.from(tags)
}

const buildPreviewTypeBadge = (
    evaluator: EvaluatorPreview,
    category: EvaluatorCategory,
): EvaluatorTypeBadge => {
    const label =
        (evaluator.meta as any)?.display_name ||
        createTypeLabel(evaluator.slug, evaluator.name) ||
        capitalize(category)

    const colorHex =
        (evaluator as any)?.color ||
        (evaluator.meta as any)?.color ||
        (evaluator.flags as any)?.color

    return {
        label,
        variant: category,
        colorHex: typeof colorHex === "string" ? colorHex : undefined,
    }
}

export const transformEvaluatorsToRows = (
    evaluators: EvaluatorPreview[],
    category: EvaluatorCategory,
): EvaluatorRegistryRow[] => {
    return evaluators.map((item) => {
        const badge = buildPreviewTypeBadge(item, category)
        const version =
            sanitizeVersion((item.meta as any)?.version) ||
            sanitizeVersion((item.data as any)?.service?.agenta) ||
            sanitizeVersion((item.data as any)?.service?.version) ||
            ""

        const updatedAt = item.updated_at || item.updatedAt
        const createdAt = item.created_at || item.createdAt

        const modifiedBy =
            (item as any)?.updated_by ||
            (item as any)?.updatedBy ||
            item.createdBy ||
            item.createdById ||
            ""

        return {
            key: item.id,
            id: item.id,
            name: item.name,
            slug: item.slug,
            typeBadge: badge,
            versionLabel: version,
            tags: collectPreviewTags(item),
            dateCreated: formatDate(createdAt),
            lastModified: formatDate(updatedAt || createdAt),
            modifiedBy: typeof modifiedBy === "string" ? modifiedBy : "",
            avatarName:
                typeof modifiedBy === "string"
                    ? modifiedBy
                    : item.createdBy || item.name || item.slug || "-",
            raw: {...item, kind: "preview"},
        }
    })
}

const buildConfigTypeBadge = (
    config: EvaluatorConfig,
    category: Extract<EvaluatorCategory, "automatic" | "custom">,
    evaluator?: Evaluator | null,
): EvaluatorTypeBadge => {
    const label = evaluator?.name || createTypeLabel(config.evaluator_key, config.name)
    const colorHex = config.color || evaluator?.color

    return {
        label,
        variant: category,
        colorHex,
    }
}

const extractConfigVersion = (config: EvaluatorConfig) => {
    const serviceValues = (config.settings_values as any)?.service || {}
    const candidate =
        (config as any)?.version ||
        serviceValues?.agenta ||
        serviceValues?.version ||
        (config.settings_values as any)?.version ||
        ""

    return sanitizeVersion(typeof candidate === "string" ? candidate : "")
}

const extractConfigModifiedBy = (config: EvaluatorConfig) => {
    const modifiedBy =
        (config as any)?.updated_by ||
        (config as any)?.updatedBy ||
        (config as any)?.created_by ||
        (config as any)?.createdBy ||
        ""

    return typeof modifiedBy === "string" ? modifiedBy : ""
}

export const transformEvaluatorConfigsToRows = (
    configs: EvaluatorConfig[],
    category: Extract<EvaluatorCategory, "automatic">,
    evaluators: Evaluator[],
): EvaluatorRegistryRow[] => {
    const evaluatorsMap = new Map(evaluators.map((item) => [item.key, item]))

    return configs.map((config) => {
        const evaluator = evaluatorsMap.get(config.evaluator_key) || null
        const badge = buildConfigTypeBadge(config, category, evaluator)
        const versionLabel = extractConfigVersion(config)
        const tags = collectConfigTags(config, evaluator)
        const modifiedBy = extractConfigModifiedBy(config)
        const createdAt = config.created_at
        const updatedAt = config.updated_at || createdAt

        const raw: EvaluatorConfigRow = {
            ...config,
            evaluator,
            kind: "config",
        }

        return {
            key: config.id,
            id: config.id,
            name: config.name,
            slug: config.evaluator_key,
            typeBadge: badge,
            versionLabel,
            tags,
            dateCreated: formatDate(createdAt),
            lastModified: formatDate(updatedAt),
            modifiedBy,
            avatarName: modifiedBy || config.name,
            raw,
        }
    })
}

const resolveDateToTimestamp = (value: unknown): number | null => {
    if (!value) return null

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.getTime()
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return value
    }

    if (typeof value === "string") {
        const parsed = Date.parse(value)
        return Number.isNaN(parsed) ? null : parsed
    }

    return null
}

const extractCreatedTimestamp = (row: EvaluatorRegistryRow): number | null => {
    const raw = row.raw as Record<string, unknown>

    const candidates = [
        raw?.created_at,
        raw?.createdAt,
        raw?.created_on,
        raw?.createdOn,
        raw?.created,
    ]

    for (const candidate of candidates) {
        const timestamp = resolveDateToTimestamp(candidate)
        if (timestamp !== null) {
            return timestamp
        }
    }

    return null
}

export const sortEvaluatorRowsByCreatedAtDesc = (
    rows: EvaluatorRegistryRow[],
): EvaluatorRegistryRow[] => {
    return [...rows].sort((a, b) => {
        const timestampA = extractCreatedTimestamp(a)
        const timestampB = extractCreatedTimestamp(b)

        if (timestampA === null && timestampB === null) return 0
        if (timestampA === null) return 1
        if (timestampB === null) return -1

        return timestampB - timestampA
    })
}
