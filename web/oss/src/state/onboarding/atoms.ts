import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

export interface OnboardingTodoItem {
    id: string
    title: string
    section?: string
    completed: boolean
    route: string
}

export const onboardingTodos: OnboardingTodoItem[] = [
    {
        id: "create-first-prompt",
        title: "Create your first prompt",
        completed: false,
        route: "/apps",
    },
    {
        id: "run-first-evaluation",
        title: "Run your first evaluation",
        completed: false,
        route: "/evaluations",
    },
    {
        id: "setup-online-evaluation",
        title: "Set up online evaluation",
        completed: false,
        route: "/observability/dashboard",
    },
    {
        id: "setup-prompt-management",
        title: "Set up prompt management",
        section: "Technical Integrations",
        completed: false,
        route: "/apps",
    },
    {
        id: "setup-tracing",
        title: "Set up tracing",
        section: "Technical Integrations",
        completed: false,
        route: "/observability/traces",
    },
    {
        id: "invite-team",
        title: "Invite your team",
        section: "Collaboration",
        completed: false,
        route: "/settings?tab=workspace",
    },
]

// Store completed todo IDs in localStorage
export const completedTodosAtom = atomWithStorage<string[]>("agenta-onboarding-completed", [])

// Widget visibility state
export const onboardingWidgetVisibleAtom = atomWithStorage(
    "agenta-onboarding-widget-visible",
    true,
)

// Track if user has seen the "how to reopen" helper
export const hasSeenReopenHelperAtom = atomWithStorage(
    "agenta-onboarding-reopen-helper-seen",
    false,
)

// Derived atom: get todos with completion status
export const onboardingTodosWithStatusAtom = atom((get) => {
    const completedIds = get(completedTodosAtom)
    return onboardingTodos.map((todo) => ({
        ...todo,
        completed: completedIds.includes(todo.id),
    }))
})

// Derived atom: calculate progress
export const onboardingProgressAtom = atom((get) => {
    const completedIds = get(completedTodosAtom)
    return {
        completed: completedIds.length,
        total: onboardingTodos.length,
        percentage: Math.round((completedIds.length / onboardingTodos.length) * 100),
    }
})

// Action atom: mark todo as complete
export const markTodoCompleteAtom = atom(null, (get, set, todoId: string) => {
    const completed = get(completedTodosAtom)
    if (!completed.includes(todoId)) {
        set(completedTodosAtom, [...completed, todoId])
    }
})

// Action atom: toggle widget visibility
export const toggleOnboardingWidgetAtom = atom(null, (get, set) => {
    const currentVisible = get(onboardingWidgetVisibleAtom)
    set(onboardingWidgetVisibleAtom, !currentVisible)
})

// Action atom: show widget
export const showOnboardingWidgetAtom = atom(null, (_get, set) => {
    set(onboardingWidgetVisibleAtom, true)
})
