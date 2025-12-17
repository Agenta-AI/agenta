import {getDefaultStore} from "jotai"

import {posthogAtom} from "@/oss/lib/helpers/analytics/store/atoms"

interface BasePayload {
    total_tasks: number
    completed_tasks: number
    skipped_tasks: number
}

const capture = (event: string, payload: Record<string, any>) => {
    const store = getDefaultStore()
    const posthog = store.get(posthogAtom)
    posthog?.capture?.(event, payload)
}

export const trackOnboardingTaskCompleted = (payload: BasePayload & {task_id: string}) => {
    capture("onboarding_task_completed", payload)
}

export const trackOnboardingTaskSkipped = (payload: BasePayload & {task_id: string}) => {
    capture("onboarding_task_skipped", payload)
}

export const trackOnboardingAllTasksCompleted = (payload: BasePayload) => {
    capture("onboarding_all_tasks_completed", payload)
}

export const trackOnboardingGuideClosed = (
    payload: BasePayload & {close_reason: "manual" | "auto_all_done"},
) => {
    capture("onboarding_guide_closed", payload)
}
