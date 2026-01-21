import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {OnboardingWidgetConfig, OnboardingWidgetItem, OnboardingWidgetStatus} from "./types"

const STORAGE_KEYS = {
    WIDGET_STATUS: "agenta:onboarding:widget-status",
    WIDGET_UI: "agenta:onboarding:widget-ui",
    COMPLETED_TASKS: "agenta:onboarding:widget-events",
    EXPANDED_SECTIONS: "agenta:onboarding:widget-expanded",
    HAS_SEEN_CLOSE_TOOLTIP: "agenta:onboarding:widget-seen-close-tooltip",
} as const

export interface OnboardingWidgetUIState {
    isOpen: boolean
    isMinimized: boolean
}

export const onboardingWidgetStatusAtom = atomWithStorage<OnboardingWidgetStatus>(
    STORAGE_KEYS.WIDGET_STATUS,
    "pending",
)

export const onboardingWidgetUIStateAtom = atomWithStorage<OnboardingWidgetUIState>(
    STORAGE_KEYS.WIDGET_UI,
    {
        isOpen: true,
        isMinimized: false,
    },
)

/** Tracks whether user has seen the tooltip about reopening widget from sidebar */
export const hasSeenCloseTooltipAtom = atomWithStorage<boolean>(
    STORAGE_KEYS.HAS_SEEN_CLOSE_TOOLTIP,
    false,
)

/** Write atom to open the widget (used by sidebar) */
export const openWidgetAtom = atom(null, (_get, set) => {
    set(onboardingWidgetUIStateAtom, {isOpen: true, isMinimized: false})
    set(onboardingWidgetStatusAtom, "pending")
})

export const onboardingWidgetConfigAtom = atom<OnboardingWidgetConfig>({
    sections: [],
})

export const onboardingWidgetActivationAtom = atom<string | null>(null)

export const setOnboardingWidgetActivationAtom = atom(
    null,
    (_get, set, activationHint: string | null) => {
        set(onboardingWidgetActivationAtom, activationHint)
    },
)

export const onboardingWidgetEventsAtom = atomWithStorage<Record<string, number>>(
    STORAGE_KEYS.COMPLETED_TASKS,
    {},
)

export const onboardingWidgetExpandedSectionsAtom = atomWithStorage<Record<string, boolean>>(
    STORAGE_KEYS.EXPANDED_SECTIONS,
    {},
)

export const onboardingWidgetCompletionAtom = atom((get) => {
    const config = get(onboardingWidgetConfigAtom)
    const events = get(onboardingWidgetEventsAtom)

    const entries = config.sections.flatMap((section) => section.items)
    const completionMap: Record<string, boolean> = {}

    entries.forEach((item) => {
        completionMap[item.id] = isItemCompleted(item, events)
    })

    return completionMap
})

export const setOnboardingWidgetConfigAtom = atom(
    null,
    (_get, set, config: OnboardingWidgetConfig) => {
        set(onboardingWidgetConfigAtom, config)
    },
)

export const recordWidgetEventAtom = atom(null, (get, set, eventId: string) => {
    const previous = get(onboardingWidgetEventsAtom)
    if (previous[eventId]) return
    set(onboardingWidgetEventsAtom, {
        ...previous,
        [eventId]: Date.now(),
    })
})

export const setWidgetSectionExpandedAtom = atom(
    null,
    (get, set, params: {sectionId: string; expanded: boolean}) => {
        const previous = get(onboardingWidgetExpandedSectionsAtom)
        set(onboardingWidgetExpandedSectionsAtom, {
            ...previous,
            [params.sectionId]: params.expanded,
        })
    },
)

const isItemCompleted = (item: OnboardingWidgetItem, events: Record<string, number>): boolean => {
    const ids = item.completionEventIds ?? []
    if (!ids.length) return false
    const mode = item.completionMode ?? "any"

    if (mode === "all") {
        return ids.every((id) => Boolean(events[id]))
    }

    return ids.some((id) => Boolean(events[id]))
}
