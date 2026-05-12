import {useMemo} from "react"

import type {EvaluatorCatalogTemplate, Workflow} from "@agenta/entities/workflow"
import {isOnlineCapableEvaluator, collectEvaluatorCandidates} from "@agenta/entities/workflow"
import type {SelectProps} from "antd"

import {getEvaluatorParameters, resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"

import {EVALUATOR_CATEGORY_LABEL_MAP, ENABLE_CORRECT_ANSWER_KEY_FILTER} from "../constants"
import {capitalize} from "../utils/evaluatorDetails"

interface UseEvaluatorSelectionParams {
    evaluators: Workflow[]
    selectedEvaluatorRevisionId: string | undefined
    previewEvaluators: Workflow[]
    baseEvaluators: EvaluatorCatalogTemplate[]
}

interface EvaluatorSelectionResult {
    evaluatorOptions: NonNullable<SelectProps["options"]>
    selectedEvaluatorConfig?: Workflow
    matchedPreviewEvaluator?: Workflow
    evaluatorTypeLookup: Map<string, {slug: string; label: string}>
}

const buildEvaluatorOptions = (configs: Workflow[]): NonNullable<SelectProps["options"]> =>
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

const buildPreviewLookup = (previewEvaluators: Workflow[]) => {
    const map = new Map<string, Workflow>()
    previewEvaluators.forEach((evaluator) => {
        const rawKey =
            resolveEvaluatorKey(evaluator) ||
            (evaluator as any)?.evaluator_key ||
            (evaluator.flags as any)?.evaluator_key ||
            (evaluator.meta as any)?.evaluator_key ||
            (evaluator as any)?.key
        if (!rawKey) return
        const normalized = String(rawKey).trim().toLowerCase()
        if (!normalized) return
        map.set(normalized, evaluator)
    })
    return map
}

const buildEvaluatorTypeLookup = (baseEvaluators: EvaluatorCatalogTemplate[]) => {
    const map = new Map<string, {slug: string; label: string}>()
    baseEvaluators.forEach((evaluator) => {
        const categories = Array.isArray(evaluator.categories) ? evaluator.categories : []
        const matched = categories
            .map((cat) => cat.toLowerCase())
            .find((cat) => EVALUATOR_CATEGORY_LABEL_MAP[cat])
        if (!matched) return
        const info = {
            slug: matched,
            label: EVALUATOR_CATEGORY_LABEL_MAP[matched] ?? capitalize(matched),
        }
        collectEvaluatorCandidates(evaluator.key, evaluator.name ?? undefined).forEach(
            (candidate) => map.set(candidate, info),
        )
    })
    return map
}

export const useEvaluatorSelection = ({
    evaluators,
    selectedEvaluatorRevisionId,
    previewEvaluators,
    baseEvaluators,
}: UseEvaluatorSelectionParams): EvaluatorSelectionResult => {
    const evaluatorsRequiringCorrectAnswerKey = useMemo(() => {
        if (!ENABLE_CORRECT_ANSWER_KEY_FILTER) return undefined
        const set = new Set<string>()
        ;(baseEvaluators || []).forEach((evaluator) => {
            const parametersSchema =
                (evaluator?.data?.schemas?.parameters as Record<string, unknown>) || {}
            const expectsCorrectAnswerKey = Object.entries(parametersSchema).some(
                ([fieldKey, field]) => {
                    if (!field || typeof field !== "object") return false
                    const meta = field as Record<string, unknown>
                    const normalizedKey = fieldKey.toLowerCase()
                    const normalizedLabel = String(meta.label || "").toLowerCase()
                    const matchesCorrectAnswerKey =
                        normalizedKey.includes("correct_answer_key") ||
                        normalizedLabel.includes("correct answer key")
                    if (!matchesCorrectAnswerKey) return false
                    return meta.required !== false
                },
            )
            if (expectsCorrectAnswerKey && evaluator?.key) {
                set.add(evaluator.key)
            }
        })
        return set
    }, [baseEvaluators])

    const allowedEvaluators = useMemo(() => {
        if (!evaluators?.length) return []
        return evaluators.filter((config) => {
            if (!config) return false
            return isOnlineCapableEvaluator(config as any)
        })
    }, [evaluators])

    const filteredEvaluators = useMemo(() => {
        if (!allowedEvaluators.length) return []
        if (!ENABLE_CORRECT_ANSWER_KEY_FILTER) return allowedEvaluators
        const requiringKey = evaluatorsRequiringCorrectAnswerKey ?? new Set<string>()
        return allowedEvaluators.filter((config) => {
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
        () => filteredEvaluators.find((item) => item.id === selectedEvaluatorRevisionId),
        [filteredEvaluators, selectedEvaluatorRevisionId],
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
