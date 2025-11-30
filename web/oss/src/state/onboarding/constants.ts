import {UserOnboardingStatus} from "./types"

export const defaultUserOnboardingState: UserOnboardingStatus = {
    apps: "idle",
    playground: "idle",
    playgroundPostRun: "idle",
    autoEvaluation: "idle",
    humanEvaluations: "idle",
    onlineEvaluation: "idle",
    observability: "idle",
    trace: "idle",
}

export const ONBOARDING_SECTIONS = Object.keys(defaultUserOnboardingState) as Array<
    keyof UserOnboardingStatus
>

export const TOUR_STEP_KEY_MAPPER: Record<string, keyof UserOnboardingStatus> = {
    trace: "trace",
    "trace-drawer": "trace",
    "playground-post-run": "playgroundPostRun",
    "auto-evaluation": "autoEvaluation",
    auto_evaluation: "autoEvaluation",
    "online-evaluation": "onlineEvaluation",
    online_evaluation: "onlineEvaluation",
    "human-evaluation": "humanEvaluations",
    human_annotation: "humanEvaluations",
}
