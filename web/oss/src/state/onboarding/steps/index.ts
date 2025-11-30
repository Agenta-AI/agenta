import {APP_MANAGEMENT_TOURS} from "./appManagementSteps"
import {evaluationTour} from "./evaluations"
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
    autoEvaluations: (ctx) => {
        return evaluationTour(ctx, "auto")
    },
    humanEvaluations: (ctx) => {
        return evaluationTour(ctx, "human")
    },
    onlineEvaluations: (ctx) => {
        return evaluationTour(ctx, "online")
    },
    trace: (ctx) => {
        const resolver = TRACE_TOURS[ctx.userContext?.userRole] ?? TRACE_TOURS.Hobbyist
        return resolver(ctx)
    },
}
