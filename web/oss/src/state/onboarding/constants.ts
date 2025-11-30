import {UserOnboardingStatus} from "./types"

export const defaultUserOnboardingState: UserOnboardingStatus = {
    apps: "idle",
    playground: "idle",
    playgroundPostRun: "idle",
    autoEvaluations: "idle",
    humanEvaluations: "idle",
    onlineEvaluations: "idle",
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
    "auto-evaluation": "autoEvaluations",
    auto_evaluation: "autoEvaluations",
    "online-evaluation": "onlineEvaluations",
    online_evaluation: "onlineEvaluations",
    "human-evaluation": "humanEvaluations",
    human_annotation: "humanEvaluations",
}
