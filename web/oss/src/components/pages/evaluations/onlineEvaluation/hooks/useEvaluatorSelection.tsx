import {useMemo} from "react"

import {SelectProps} from "antd"

import {getEvaluatorParameters, resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import type {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"
import type {Evaluator, SimpleEvaluator} from "@/oss/lib/Types"

import {
    ALLOWED_ONLINE_EVALUATOR_KEYS,
    EVALUATOR_CATEGORY_LABEL_MAP,
    ENABLE_CORRECT_ANSWER_KEY_FILTER,
} from "../constants"
import {capitalize, collectEvaluatorCandidates} from "../utils/evaluatorDetails"

interface UseEvaluatorSelectionParams {
    evaluators: SimpleEvaluator[]
    selectedEvaluatorId: string | undefined
    previewEvaluators: EvaluatorPreviewDto[]
    baseEvaluators: Evaluator[]
}

interface EvaluatorSelectionResult {
    evaluatorOptions: SelectProps["options"]
    selectedEvaluatorConfig?: SimpleEvaluator
    matchedPreviewEvaluator?: EvaluatorPreviewDto
    evaluatorTypeLookup: Map<string, {slug: string; label: string}>
}

const buildEvaluatorOptions = (configs: SimpleEvaluator[]): SelectProps["options"] =>
    (configs || []).map((cfg: any) => {
        const iconSrc = (cfg?.icon_url && (cfg.icon_url.src || cfg.icon_url)) || undefined
        const displayName = cfg?.name || ""
        const evaluatorKey = resolveEvaluatorKey(cfg)
        const searchable = [displayName, evaluatorKey, cfg?.id, cfg?.slug, cfg?.data?.uri]
            .map((item) => {
                if (item === undefined || item === null) return undefined
                const text = String(item).trim()
                return text.length > 0 ? text : undefined
            })
            .filter(Boolean)
            .join(" ")

        const content = (
            <div className="flex items-center gap-2">
                {iconSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={iconSrc} alt={displayName} width={16} height={16} />
                ) : null}
                <span>{displayName}</span>
            </div>
        )

        return {
            value: cfg?.id,
            label: content,
            title: displayName,
            searchText: searchable,
        }
    })

const buildPreviewLookup = (previewEvaluators: EvaluatorPreviewDto[]) => {
    const map = new Map<string, EvaluatorPreviewDto>()
    previewEvaluators.forEach((evaluator) => {
        const rawKey =
            resolveEvaluatorKey(evaluator as any) ||
            (evaluator as any)?.evaluator_key ||
            (evaluator as any)?.flags?.evaluator_key ||
            (evaluator as any)?.meta?.evaluator_key ||
            (evaluator as any)?.key
        if (!rawKey) return
        const normalized = String(rawKey).trim().toLowerCase()
        if (!normalized) return
        map.set(normalized, evaluator)
    })
    return map
}

const buildEvaluatorTypeLookup = (baseEvaluators: Evaluator[]) => {
    const map = new Map<string, {slug: string; label: string}>()
    baseEvaluators.forEach((evaluator) => {
        const tags = Array.isArray(evaluator.tags) ? evaluator.tags : []
        const matched = tags
            .map((tag) => tag.toLowerCase())
            .find((tag) => EVALUATOR_CATEGORY_LABEL_MAP[tag])
        if (!matched) return
        const info = {
            slug: matched,
            label: EVALUATOR_CATEGORY_LABEL_MAP[matched] ?? capitalize(matched),
        }
        collectEvaluatorCandidates(evaluator.key, evaluator.name, (evaluator as any)?.slug).forEach(
            (candidate) => map.set(candidate, info),
        )
    })
    return map
}

export const useEvaluatorSelection = ({
    evaluators,
    selectedEvaluatorId,
    previewEvaluators,
    baseEvaluators,
}: UseEvaluatorSelectionParams): EvaluatorSelectionResult => {
    const evaluatorsRequiringCorrectAnswerKey = useMemo(() => {
        if (!ENABLE_CORRECT_ANSWER_KEY_FILTER) return undefined
        const set = new Set<string>()
        ;(baseEvaluators || []).forEach((evaluator) => {
            const template = evaluator?.settings_template || {}
            const expectsCorrectAnswerKey = Object.entries(template).some(([fieldKey, field]) => {
                if (!field) return false
                const normalizedKey = fieldKey.toLowerCase()
                const normalizedLabel = String(field.label || "").toLowerCase()
                const matchesCorrectAnswerKey =
                    normalizedKey.includes("correct_answer_key") ||
                    normalizedLabel.includes("correct answer key")
                if (!matchesCorrectAnswerKey) return false
                return field.required !== false
            })
            if (expectsCorrectAnswerKey && evaluator?.key) {
                set.add(evaluator.key)
            }
        })
        return set
    }, [baseEvaluators])

    const allowedEvaluators = useMemo(() => {
        if (!evaluators?.length) return []
        return evaluators.filter((config: SimpleEvaluator) => {
            if (!config) return false
            const evaluatorKey = resolveEvaluatorKey(config)
            const candidates = collectEvaluatorCandidates(
                evaluatorKey,
                config?.slug,
                config?.name,
                (config as any)?.key,
                config?.meta?.evaluator_key,
                config?.meta?.key,
            )
            if (!candidates.length) return false
            return candidates.some((candidate) => ALLOWED_ONLINE_EVALUATOR_KEYS.has(candidate))
        })
    }, [evaluators])

    const filteredEvaluators = useMemo(() => {
        if (!allowedEvaluators.length) return []
        if (!ENABLE_CORRECT_ANSWER_KEY_FILTER) return allowedEvaluators
        const requiringKey = evaluatorsRequiringCorrectAnswerKey ?? new Set<string>()
        return allowedEvaluators.filter((config: SimpleEvaluator) => {
            if (!config) return false
            const evaluatorKey = resolveEvaluatorKey(config)
            if (evaluatorKey && requiringKey.has(evaluatorKey)) {
                return false
            }
            const settingsValues = getEvaluatorParameters(config)
            const requiresCorrectAnswerKey = Object.entries(settingsValues).some(([key, value]) => {
                if (!key) return false
                const normalizedKey = key.toLowerCase()
                const matchesCorrectAnswerKey = normalizedKey.includes("correct_answer_key")
                if (!matchesCorrectAnswerKey) return false
                if (value === undefined || value === null) return false
                if (typeof value === "string") {
                    return value.trim().length > 0
                }
                return true
            })
            return !requiresCorrectAnswerKey
        })
    }, [allowedEvaluators, evaluatorsRequiringCorrectAnswerKey])

    const evaluatorOptions = useMemo(
        () => buildEvaluatorOptions(filteredEvaluators),
        [filteredEvaluators],
    )

    const selectedEvaluatorConfig = useMemo(
        () => filteredEvaluators.find((item: any) => item.id === selectedEvaluatorId),
        [filteredEvaluators, selectedEvaluatorId],
    )

    const previewLookup = useMemo(() => buildPreviewLookup(previewEvaluators), [previewEvaluators])

    const matchedPreviewEvaluator = useMemo(() => {
        const key = resolveEvaluatorKey(selectedEvaluatorConfig)
        if (!key) return undefined
        return previewLookup.get(key.toLowerCase())
    }, [selectedEvaluatorConfig, previewLookup])

    const evaluatorTypeLookup = useMemo(
        () => buildEvaluatorTypeLookup(baseEvaluators),
        [baseEvaluators],
    )

    return {
        evaluatorOptions,
        selectedEvaluatorConfig,
        matchedPreviewEvaluator,
        evaluatorTypeLookup,
    }
}
