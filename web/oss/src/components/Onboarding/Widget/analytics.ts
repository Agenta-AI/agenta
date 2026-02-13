import {getDefaultStore} from "jotai"

import {posthogAtom} from "@/oss/lib/helpers/analytics/store/atoms"
import type {OnboardingWidgetItem} from "@/oss/lib/onboarding"

interface WidgetAnalyticsPayload {
    taskId?: string
    sectionId?: string
    totalTasks?: number
    completedTasks?: number
}

const capture = (event: string, payload: WidgetAnalyticsPayload) => {
    const store = getDefaultStore()
    const posthog = store.get(posthogAtom)
    posthog?.capture?.(event, payload)
}

export const trackWidgetOpened = (payload: WidgetAnalyticsPayload) => {
    capture("onboarding_widget_opened", payload)
}

export const trackWidgetClosed = (payload: WidgetAnalyticsPayload) => {
    capture("onboarding_widget_closed", payload)
}

export const trackWidgetTaskClicked = (item: OnboardingWidgetItem) => {
    capture("onboarding_widget_task_clicked", {
        taskId: item.id,
    })
}

export const trackWidgetTaskCompleted = (payload: WidgetAnalyticsPayload) => {
    capture("onboarding_widget_task_completed", payload)
}

export const trackWidgetTaskEventRecorded = (eventId: string) => {
    capture("onboarding_widget_event_recorded", {
        taskId: eventId,
    })
}
