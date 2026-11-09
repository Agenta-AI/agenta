import type {OnboardingAnswers} from "./onboardingQuestions"

const LARGE_COMPANY_SIZES = new Set(["51-200", "201+"])

/** A company of 51 or more people also gets the Enterprise line in the offer. */
export const isLargeCompany = (answers: OnboardingAnswers) => {
    const size = answers.size
    return typeof size === "string" && LARGE_COMPANY_SIZES.has(size)
}

/** The registration offer after the survey: self-hosted, for the instance admin, with no key. */
export const shouldOfferRegistration = ({
    selfHosted,
    isInstanceAdmin,
    hasKey,
}: {
    selfHosted: boolean
    isInstanceAdmin: boolean
    hasKey: boolean
}) => selfHosted && isInstanceAdmin && !hasKey

const offerSeenKey = (userId: string) => `agenta:onboarding:registration-offer:${userId}`

/** The offer shows once per user, also across tabs while onboarding is still pending. */
export const markRegistrationOfferSeen = (userId: string) => {
    try {
        window.localStorage.setItem(offerSeenKey(userId), "1")
    } catch {
        // Storage restrictions only cost a second offer, never the onboarding.
    }
}

export const isRegistrationOfferSeen = (userId: string): boolean => {
    try {
        return window.localStorage.getItem(offerSeenKey(userId)) !== null
    } catch {
        return false
    }
}
