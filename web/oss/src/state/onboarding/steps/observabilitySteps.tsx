import {OnboardingStepsContext, TourDefinition} from "./types"

const EMPTY_TOUR: TourDefinition = []

const OBSERVABILITY_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: () => EMPTY_TOUR,
    "ML/AI Engineer or Data scientist": () => EMPTY_TOUR,
    "Frontend / Backend Developer": () => EMPTY_TOUR,
}

export const OBSERVABILITY_TOURS = new Proxy(OBSERVABILITY_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof OBSERVABILITY_TOUR_MAP
