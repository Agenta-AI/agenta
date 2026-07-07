export {default as OnboardingCard} from "./OnboardingCard"
export {default as OnboardingProvider} from "./OnboardingProvider"
// OnboardingWidget is mounted directly (behind a dynamic import) from AppGlobalWrappers,
// not re-exported here — that mount is currently disabled. Re-exporting it from this
// barrel would pull its top-level `@agentaai/nextstepjs` import into every module that
// imports anything else from this barrel (e.g. useOnboardingTour), defeating the
// tours-disabled kill switch. Import it directly from "./Widget" if ever needed again.
export {useOnboardingTour} from "./hooks/useOnboardingTour"

// Tours
export {
    registerEvaluationResultsTour,
    unregisterEvaluationResultsTour,
    EVALUATION_RESULTS_TOUR_ID,
} from "./tours/evaluationResultsTour"
export {
    registerExplorePlaygroundTour,
    unregisterExplorePlaygroundTour,
    EXPLORE_PLAYGROUND_TOUR_ID,
} from "./tours/explorePlaygroundTour"
export {
    registerDeployPromptTour,
    unregisterDeployPromptTour,
    DEPLOY_PROMPT_TOUR_ID,
} from "./tours/deployPromptTour"
export {
    registerFirstEvaluationTour,
    unregisterFirstEvaluationTour,
    FIRST_EVALUATION_TOUR_ID,
} from "./tours/firstEvaluationTour"
