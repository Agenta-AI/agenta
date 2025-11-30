import {getDefaultStore} from "jotai"

import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {lastVisitedEvaluationAtom} from "@/oss/components/pages/evaluations/state/lastVisitedEvaluationAtom"

import {ONBOARDING_SECTIONS, TOUR_STEP_KEY_MAPPER} from "../onboarding/constants"
import {UserOnboardingStatus} from "../onboarding/types"

export type ResolveOnboardingSectionOptions = {
    evalType?: string | null
    lastVisitedEvaluation?: string | null
}

const resolveEvaluationSection = (
    value?: string | null | undefined,
    options?: ResolveOnboardingSectionOptions,
): keyof UserOnboardingStatus => {
    if (value) {
        const normalized = value.toLowerCase()
        if (normalized.includes("online")) return "onlineEvaluations"
        if (normalized.includes("human")) return "humanEvaluations"
        return "autoEvaluations"
    }

    const store = getDefaultStore()
    const evalType = options?.evalType ?? store.get(evalTypeAtom)
    const lastVisited = options?.lastVisitedEvaluation ?? store.get(lastVisitedEvaluationAtom)

    if (evalType === "online" || lastVisited?.includes("online")) return "onlineEvaluations"
    if (evalType === "human" || lastVisited?.includes("human")) return "humanEvaluations"
    return "autoEvaluations"
}

export const resolveOnboardingSection = (
    value: string | null,
    options?: ResolveOnboardingSectionOptions,
): keyof UserOnboardingStatus | null => {
    if (!value) return null
    if (ONBOARDING_SECTIONS.includes(value as keyof UserOnboardingStatus)) {
        return value as keyof UserOnboardingStatus
    }

    const candidates = value
        .split("/")
        .map((part) => part.trim())
        .filter((part): part is string => Boolean(part))
        .flatMap((part) => {
            const lower = part.toLowerCase()
            return [lower, lower.replace(/_/g, "-"), lower.replace(/[-_\s]/g, "")]
        })

    for (const candidate of candidates) {
        if (candidate === "evaluation" || candidate === "evaluations") {
            return resolveEvaluationSection(null, options)
        }
        const mapped = TOUR_STEP_KEY_MAPPER[candidate]
        if (mapped) {
            if (mapped === "autoEvaluations" && candidate.includes("evaluation")) {
                return resolveEvaluationSection(null, options)
            }
            return mapped
        }
    }

    const resolvedFromValue = resolveEvaluationSection(value, options)
    if (resolvedFromValue) return resolvedFromValue
    return null
}
