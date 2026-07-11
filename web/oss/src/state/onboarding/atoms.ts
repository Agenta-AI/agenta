import {atom} from "jotai"

/**
 * Live state of the playground-native onboarding session. Sole writer: `useAgentOnboarding`
 * (it mirrors its lifecycle here so surfaces OUTSIDE the playground subtree — the sidebar,
 * the layout — can react without reaching into the playground-scoped React context).
 */
export interface OnboardingSessionState {
    /** The onboarding playground surface is mounted (true from mint through post-commit). */
    active: boolean
    /** Set once the ephemeral commits to a real agent revision; null while still onboarding. */
    committedRevisionId: string | null
}

export const ONBOARDING_SESSION_DEFAULT: OnboardingSessionState = {
    active: false,
    committedRevisionId: null,
}

export const onboardingSessionAtom = atom<OnboardingSessionState>(ONBOARDING_SESSION_DEFAULT)
