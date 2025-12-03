import {atom} from "jotai"
import {atomWithStorage, createJSONStorage} from "jotai/utils"
import {OnboardingState, UserOnboardingStatus} from "../types"
import {currentOnboardingStepWithLocationAtom} from "./stepsAtom"

export type OnboardingWidgetPosition = {
    x: number
    y: number
}

const ONBOARDING_WIDGET_COMPLETION_KEY = "onboarding-widget-completion"
const ONBOARDING_WIDGET_SKIPPED_KEY = "onboarding-widget-skipped"
const ONBOARDING_WIDGET_UI_STATE_KEY = "onboarding-widget-ui-state"

type OnboardingWidgetUIState = {
    minimized: boolean
    position: OnboardingWidgetPosition | null
    minimizeHint: boolean
    togglePosition: OnboardingWidgetPosition | null
    closed: boolean
}

export type RunningWidgetOnboarding = {
    section: keyof UserOnboardingStatus
    completionKey: string
    initialStatus: OnboardingState
}

export const currentRunningWidgetOnboardingAtom = atom<RunningWidgetOnboarding | null>(null)

export const onboardingWidgetCompletionAtom = atomWithStorage<Record<string, boolean>>(
    ONBOARDING_WIDGET_COMPLETION_KEY,
    {},
)

export const onboardingWidgetSkippedAtom = atomWithStorage<Record<string, boolean>>(
    ONBOARDING_WIDGET_SKIPPED_KEY,
    {},
)

const onboardingWidgetUIStateAtom = atomWithStorage<OnboardingWidgetUIState>(
    ONBOARDING_WIDGET_UI_STATE_KEY,
    {
        minimized: false,
        position: null,
        minimizeHint: false,
        togglePosition: null,
        closed: false,
    },
    createJSONStorage(() => (typeof window === "undefined" ? undefined : localStorage)),
    {getOnInit: true},
)

export const onboardingWidgetMinimizedAtom = atom(
    (get) => get(onboardingWidgetUIStateAtom).minimized,
    (get, set, update: boolean | ((prev: boolean) => boolean)) => {
        const prev = get(onboardingWidgetUIStateAtom)
        const nextValue = typeof update === "function" ? update(prev.minimized) : update
        set(onboardingWidgetUIStateAtom, {
            ...prev,
            minimized: nextValue,
        })
    },
)

export const onboardingWidgetPositionAtom = atom(
    (get) => get(onboardingWidgetUIStateAtom).position,
    (
        get,
        set,
        update:
            | OnboardingWidgetPosition
            | null
            | ((prev: OnboardingWidgetPosition | null) => OnboardingWidgetPosition | null),
    ) => {
        const prev = get(onboardingWidgetUIStateAtom)
        const nextValue = typeof update === "function" ? update(prev.position) : update
        set(onboardingWidgetUIStateAtom, {
            ...prev,
            position: nextValue,
        })
    },
)

export const onboardingWidgetMinimizeHintAtom = atom(
    (get) => get(onboardingWidgetUIStateAtom).minimizeHint,
    (get, set, update: boolean | ((prev: boolean) => boolean)) => {
        const prev = get(onboardingWidgetUIStateAtom)
        const nextValue = typeof update === "function" ? update(prev.minimizeHint) : update
        set(onboardingWidgetUIStateAtom, {
            ...prev,
            minimizeHint: nextValue,
        })
    },
)

export const onboardingWidgetTogglePositionAtom = atom(
    (get) => get(onboardingWidgetUIStateAtom).togglePosition,
    (
        get,
        set,
        update:
            | OnboardingWidgetPosition
            | null
            | ((prev: OnboardingWidgetPosition | null) => OnboardingWidgetPosition | null),
    ) => {
        const prev = get(onboardingWidgetUIStateAtom)
        const nextValue = typeof update === "function" ? update(prev.togglePosition) : update
        set(onboardingWidgetUIStateAtom, {
            ...prev,
            togglePosition: nextValue,
        })
    },
)

export const onboardingWidgetClosedAtom = atom(
    (get) => get(onboardingWidgetUIStateAtom).closed,
    (get, set, update: boolean | ((prev: boolean) => boolean)) => {
        const prev = get(onboardingWidgetUIStateAtom)
        const nextValue = typeof update === "function" ? update(prev.closed) : update

        set(onboardingWidgetUIStateAtom, {
            ...prev,
            closed: nextValue,
        })
    },
)
