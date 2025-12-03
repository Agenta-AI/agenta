import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {lastVisitedEvaluationAtom} from "@/oss/components/pages/evaluations/state/lastVisitedEvaluationAtom"
import {getDefaultStore} from "jotai"
import {OnboardingStepsContext} from "../types"
import {AUTO_EVALUATION_TOURS} from "./autoEvaluationSteps"
import {ONLINE_EVALUATION_TOURS} from "./onlineEvaluationSteps"

type EvaluationTourType = "auto" | "human" | "online"

const resolveRequestedType = (
    requested: EvaluationTourType | undefined,
    lastVisited: string | null,
    evalType: "auto" | "human" | "online" | "custom" | null,
): EvaluationTourType => {
    if (requested) return requested
    if (evalType === "online") return "online"
    if (evalType === "human") return "human"
    if (evalType === "auto") return "auto"
    const normalized = lastVisited?.toLowerCase() ?? ""
    if (normalized.includes("online")) return "online"
    if (normalized.includes("human")) return "human"
    return "auto"
}

export const evaluationTour = (ctx: OnboardingStepsContext, type?: EvaluationTourType) => {
    const store = getDefaultStore()
    const currentEval = store.get(lastVisitedEvaluationAtom)
    const evalType = store.get(evalTypeAtom)
    const role = ctx.userContext?.userRole as string | undefined
    const resolvedType = resolveRequestedType(type, currentEval, evalType)

    if (resolvedType === "online") {
        const resolver = (ONLINE_EVALUATION_TOURS as any)[role]
        return resolver(ctx)
    }

    if (resolvedType === "auto") {
        const resolver = (AUTO_EVALUATION_TOURS as any)[role]
        return resolver(ctx)
    }

    return []
}
