import {roles, sources} from "./choices"

export interface OnboardingDraft {
    step: number
    role: string
    source: string
    name: string
    task: string
    templateKey: string | null
}

export const onboardingDraftKey = (projectId: string) => `agenta-onboarding-draft-v1:${projectId}`

export function readOnboardingDraft(key?: string): Partial<OnboardingDraft> {
    if (!key || typeof window === "undefined") return {}
    try {
        const draft = JSON.parse(window.sessionStorage.getItem(key) ?? "null")
        if (
            !draft ||
            !Number.isInteger(draft.step) ||
            draft.step < 1 ||
            draft.step > 5 ||
            !roles.includes(draft.role) ||
            (draft.step > 2 && !sources.includes(draft.source)) ||
            typeof draft.source !== "string" ||
            typeof draft.name !== "string" ||
            typeof draft.task !== "string" ||
            !(draft.templateKey === null || typeof draft.templateKey === "string")
        )
            return {}
        return draft
    } catch {
        return {}
    }
}

export function saveOnboardingDraft(key: string | undefined, draft: OnboardingDraft | null) {
    if (!key) return
    try {
        if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft))
        else window.sessionStorage.removeItem(key)
    } catch {
        // Storage restrictions must not block onboarding.
    }
}
