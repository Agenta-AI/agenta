import {APP_MANAGEMENT_TOURS} from "./appManagementSteps"
import {evaluationTour} from "./evaluations"
import {OBSERVABILITY_TOURS} from "./observabilitySteps"
import {PLAYGROUND_TOURS, resolvePlaygroundPostRunTour} from "./playgroundSteps"
import {TRACE_TOURS} from "./traceSteps"
import {OnboardingStepsContext, TourDefinition} from "./types"

export const TOUR_STEPS: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    apps: (ctx) => {
        return APP_MANAGEMENT_TOURS[ctx.userContext?.userRole](ctx)
    },
    playground: (ctx) => {
        return PLAYGROUND_TOURS[ctx.userContext?.userRole](ctx)
    },
    playgroundPostRun: (_ctx) => {
        return resolvePlaygroundPostRunTour()
    },
    evaluations: (ctx) => {
        return evaluationTour(ctx)
    },
    trace: (ctx) => {
        const resolver = TRACE_TOURS[ctx.userContext?.userRole] ?? TRACE_TOURS.Hobbyist
        return resolver(ctx)
    },
}
