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

    if (currentEval === "online_evaluation" || evalType === "online") {
        return ONLINE_EVALUATION_TOURS(ctx)[ctx.userContext?.userRole]
    }

    if (currentEval === "auto_evaluation" || evalType === "auto") {
        return AUTO_EVALUATION_TOURS(ctx)[ctx.userContext?.userRole]
    }

    if (currentEval === "human_evaluation" || evalType === "human") {
        return HUMAN_EVALUATION_TOURS(ctx)[ctx.userContext?.userRole]
    }

    return []
}
