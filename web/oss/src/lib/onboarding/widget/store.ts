import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

import {onboardingStorageUserIdAtom} from "../atoms"

import type {OnboardingWidgetConfig, OnboardingWidgetItem, OnboardingWidgetStatus} from "./types"

const STORAGE_KEYS = {
    WIDGET_STATUS: "widget-status",
    WIDGET_UI: "widget-ui",
    COMPLETED_TASKS: "widget-events",
    EXPANDED_SECTIONS: "widget-expanded",
    HAS_SEEN_CLOSE_TOOLTIP: "widget-seen-close-tooltip",
    MANUALLY_COLLAPSED: "widget-manually-collapsed",
} as const

const createScopedStorageKey = (userId: string, key: string) => `agenta:onboarding:${userId}:${key}`

export interface OnboardingWidgetUIState {
    isOpen: boolean
    isMinimized: boolean
}

const widgetStatusAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<OnboardingWidgetStatus>(
        createScopedStorageKey(userId, STORAGE_KEYS.WIDGET_STATUS),
        "pending",
    ),
)

export const onboardingWidgetStatusAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return "pending"
        return get(widgetStatusAtomFamily(userId))
    },
    (get, set, next: OnboardingWidgetStatus) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(widgetStatusAtomFamily(userId), next)
    },
)

const widgetUIAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<OnboardingWidgetUIState>(
        createScopedStorageKey(userId, STORAGE_KEYS.WIDGET_UI),
        {
            isOpen: false,
            isMinimized: false,
        },
    ),
)

export const onboardingWidgetUIStateAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return {isOpen: false, isMinimized: false}
        return get(widgetUIAtomFamily(userId))
    },
    (get, set, next: OnboardingWidgetUIState) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(widgetUIAtomFamily(userId), next)
    },
)

/** Tracks whether user has seen the tooltip about reopening widget from sidebar */
const hasSeenCloseTooltipAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(
        createScopedStorageKey(userId, STORAGE_KEYS.HAS_SEEN_CLOSE_TOOLTIP),
        false,
    ),
)

export const hasSeenCloseTooltipAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return false
        return get(hasSeenCloseTooltipAtomFamily(userId))
    },
    (get, set, next: boolean) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(hasSeenCloseTooltipAtomFamily(userId), next)
    },
)

export const openWidgetAtom = atom(null, async (get, set) => {
    let userId = get(onboardingStorageUserIdAtom)

    if (!userId && typeof window !== "undefined") {
        try {
            const mod = await import("supertokens-auth-react/recipe/session")
            const Session = mod.default

            try {
                userId = await Session.getUserId()
            } catch {
                // ignore user id lookup failures
            }

            if (!userId) {
                try {
                    const payload = await Session.getAccessTokenPayloadSecurely()
                    userId =
                        typeof payload?.user_id === "string"
                            ? payload.user_id
                            : typeof payload?.sub === "string"
                              ? payload.sub
                              : null
                } catch {
                    // ignore payload lookup failures
                }
            }

            if (typeof userId === "string" && userId) {
                set(onboardingStorageUserIdAtom, userId)
            }
        } catch {
            // ignore user id lookup failures
        }
    }

    if (!userId) return

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

const widgetEventsAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<Record<string, number>>(
        createScopedStorageKey(userId, STORAGE_KEYS.COMPLETED_TASKS),
        {},
    ),
)

export const onboardingWidgetEventsAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return {}
        return get(widgetEventsAtomFamily(userId))
    },
    (get, set, next: Record<string, number>) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(widgetEventsAtomFamily(userId), next)
    },
)

const widgetExpandedSectionsAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<Record<string, boolean>>(
        createScopedStorageKey(userId, STORAGE_KEYS.EXPANDED_SECTIONS),
        {},
    ),
)

export const onboardingWidgetExpandedSectionsAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return {}
        return get(widgetExpandedSectionsAtomFamily(userId))
    },
    (get, set, next: Record<string, boolean>) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(widgetExpandedSectionsAtomFamily(userId), next)
    },
)

const widgetManuallyCollapsedSectionsAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<Record<string, boolean>>(
        createScopedStorageKey(userId, STORAGE_KEYS.MANUALLY_COLLAPSED),
        {},
    ),
)

export const onboardingWidgetManuallyCollapsedAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return {}
        return get(widgetManuallyCollapsedSectionsAtomFamily(userId))
    },
    (get, set, next: Record<string, boolean>) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(widgetManuallyCollapsedSectionsAtomFamily(userId), next)
    },
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

export const firstIncompleteSectionIdAtom = atom((get) => {
    const config = get(onboardingWidgetConfigAtom)
    const completionMap = get(onboardingWidgetCompletionAtom)

    // Find first section with at least one incomplete item
    for (const section of config.sections) {
        const hasIncompleteItems = section.items.some((item) => !completionMap[item.id])
        if (hasIncompleteItems) {
            return section.id
        }
    }

    // All sections complete - return first section to show achievement
    return config.sections.length > 0 ? config.sections[0].id : null
})

export const computedExpandedSectionsAtom = atom((get) => {
    const config = get(onboardingWidgetConfigAtom)
    const firstIncomplete = get(firstIncompleteSectionIdAtom)
    const manuallyCollapsed = get(onboardingWidgetManuallyCollapsedAtom)
    const explicitExpanded = get(onboardingWidgetExpandedSectionsAtom)

    const computed: Record<string, boolean> = {}

    config.sections.forEach((section) => {
        const sectionId = section.id

        // Priority 1: If user manually collapsed this section, respect that
        if (manuallyCollapsed[sectionId]) {
            computed[sectionId] = false
            return
        }

        // Priority 2: If user manually expanded this section, respect that
        if (explicitExpanded[sectionId] === true) {
            computed[sectionId] = true
            return
        }

        // Priority 3: Auto-expand first incomplete section
        if (sectionId === firstIncomplete) {
            computed[sectionId] = true
            return
        }

        // Default: collapsed
        computed[sectionId] = false
    })

    return computed
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

export const setWidgetSectionManuallyCollapsedAtom = atom(
    null,
    (get, set, params: {sectionId: string; collapsed: boolean}) => {
        const previous = get(onboardingWidgetManuallyCollapsedAtom)
        if (params.collapsed) {
            set(onboardingWidgetManuallyCollapsedAtom, {
                ...previous,
                [params.sectionId]: true,
            })
        } else {
            // Remove from manually collapsed when user expands
            const next = {...previous}
            delete next[params.sectionId]
            set(onboardingWidgetManuallyCollapsedAtom, next)
        }
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
