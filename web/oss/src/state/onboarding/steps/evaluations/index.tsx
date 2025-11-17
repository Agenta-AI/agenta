import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {lastVisitedEvaluationAtom} from "@/oss/components/pages/evaluations/state/lastVisitedEvaluationAtom"
import {getDefaultStore} from "jotai"
import {OnboardingStepsContext} from "../types"
import {AUTO_EVALUATION_TOURS} from "./autoEvaluationSteps"
import {HUMAN_EVALUATION_TOURS} from "./humanEvaluationSteps"
import {ONLINE_EVALUATION_TOURS} from "./onlineEvaluationSteps"

export const evaluationTour = (ctx: OnboardingStepsContext) => {
    const currentEval = getDefaultStore().get(lastVisitedEvaluationAtom)
    const evalType = getDefaultStore().get(evalTypeAtom)
    const role = ctx.userContext?.userRole as string | undefined

    if (currentEval === "online_evaluation" || evalType === "online") {
        const resolver = (ONLINE_EVALUATION_TOURS as any)[role] ?? ONLINE_EVALUATION_TOURS.Hobbyist
        return resolver(ctx)
    }

    if (currentEval === "auto_evaluation" || evalType === "auto") {
        // const resolver = (AUTO_EVALUATION_TOURS as any)[role] ?? AUTO_EVALUATION_TOURS.Hobbyist
        return []
    }

    if (currentEval === "human_evaluation" || evalType === "human") {
        const resolver = (HUMAN_EVALUATION_TOURS as any)[role] ?? HUMAN_EVALUATION_TOURS.Hobbyist
        return resolver(ctx)
    }

    return []
}
