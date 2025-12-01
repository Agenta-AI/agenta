import {OnboardingStepsContext, TourDefinition} from "../types"

const EMPTY_STEPS: TourDefinition = []

const AUTO_EVALUATION_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: (ctx) => EMPTY_STEPS,
}

export const AUTO_EVALUATION_TOURS = new Proxy(AUTO_EVALUATION_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof AUTO_EVALUATION_TOUR_MAP
