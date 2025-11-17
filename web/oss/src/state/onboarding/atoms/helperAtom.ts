import {atom} from "jotai"
import {runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"
import {isComparisonViewAtom} from "@/oss/components/Playground/state/atoms"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {playgroundLoadingAtom} from "@/oss/state/loadingSelectors"
import {getCurrentRunId, totalCountFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {evaluatorsQueryAtomFamily} from "@/oss/state/evaluators"
import {
    ALLOWED_ONLINE_EVALUATOR_KEYS,
    ENABLE_CORRECT_ANSWER_KEY_FILTER,
} from "@/oss/components/pages/evaluations/onlineEvaluation/constants"
import {collectEvaluatorCandidates} from "@/oss/components/pages/evaluations/onlineEvaluation/utils/evaluatorDetails"

// ********************************* PLAYGROUND ATOMS ********************************* //
/**
 * This atom is used to determine if the user has run a generation in the playground for the first time
 */
export const playgroundHasFirstRunAtom = atom((get) => {
    const statuses = get(runStatusByRowRevisionAtom) || {}
    return Object.values(statuses).some((entry) => {
        if (!entry) return false
        const hasCompletedRun =
            entry.resultHash !== undefined &&
            (entry.isRunning === false || entry.isRunning === undefined)
        return hasCompletedRun
    })
})

// This atom is used to determine if the user can run the playground onboarding
export const isPlaygroundOnboardingRunableAtom = atom((get) => {
    const isCompareMode = get(isComparisonViewAtom)
    const appType = get(currentAppContextAtom)?.appType || null
    const isLoading = get(playgroundLoadingAtom)

    if (isLoading) return false
    if (isCompareMode) return false
    if (appType === "custom") return false
    return true
})

// ********************************* ONLINE EVALUATION ATOMS ********************************* //

export const isOnlineEvaluationScenarioAvailableAtom = atom((get) => {
    const runId = getCurrentRunId()
    const scenarioCount = get(totalCountFamily(runId))
    return scenarioCount > 0
})

// This atom is used to determine if the user have evaluators available to run online evaluation
export const isOnlineEvaluatorAvailableAtom = atom((get) => {
    const configs: any[] = get(evaluatorConfigsAtom) || []
    const baseEvaluators: any[] = get(evaluatorsAtom) || []

    if (!configs.length) return false

    // 1) Allowed evaluators based on known keys
    const allowedEvaluators = configs.filter((config: any) => {
        if (!config) return false
        const candidates = collectEvaluatorCandidates(
            config?.evaluator_key,
            (config as any)?.slug,
            config?.name,
            config?.key,
            config?.meta?.evaluator_key,
            config?.meta?.key,
        )
        if (!candidates.length) return false
        return candidates.some((candidate) => ALLOWED_ONLINE_EVALUATOR_KEYS.has(candidate))
    })

    if (!allowedEvaluators.length) return false

    // 2) Optional: filter out evaluators requiring a correct_answer_key depending on feature flag
    if (!ENABLE_CORRECT_ANSWER_KEY_FILTER) return allowedEvaluators.length > 0

    // Build a set of evaluator keys that require correct_answer_key (from base evaluators templates)
    const requiringKey = (() => {
        const set = new Set<string>()
        ;(baseEvaluators || []).forEach((evaluator) => {
            const template = evaluator?.settings_template || {}
            const expectsCorrectAnswerKey = Object.entries(template).some(
                ([fieldKey, field]: any) => {
                    if (!field) return false
                    const normalizedKey = String(fieldKey || "").toLowerCase()
                    const normalizedLabel = String(field?.label || "").toLowerCase()
                    const matches =
                        normalizedKey.includes("correct_answer_key") ||
                        normalizedLabel.includes("correct answer key")
                    if (!matches) return false
                    return field?.required !== false
                },
            )
            if (expectsCorrectAnswerKey && evaluator?.key) {
                set.add(evaluator.key)
            }
        })
        return set
    })()

    const filteredEvaluators = allowedEvaluators.filter((config: any) => {
        if (!config) return false
        const evaluatorKey = config?.evaluator_key
        if (evaluatorKey && requiringKey.has(evaluatorKey)) {
            return false
        }
        const settingsValues = config?.settings_values || {}
        const requiresCorrectAnswerKey = Object.entries(settingsValues).some(([key, value]) => {
            if (!key) return false
            const normalizedKey = String(key).toLowerCase()
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

    return filteredEvaluators.length > 0
})

// ********************************* HUMAN EVALUATION ATOMS ********************************* //
export const isHumanEvaluatorAvailableAtom = atom((get) => {
    const params = {
        projectId: null,
        preview: true,
        queriesKey: JSON.stringify({is_human: true}),
    }
    const queryAtom = evaluatorsQueryAtomFamily(params)
    const q: any = get(queryAtom)
    const evaluators = (q?.data as any[]) ?? []
    return evaluators.length > 0
})

// ********************************* GENERAL EVALUATION ATOMS ********************************* //