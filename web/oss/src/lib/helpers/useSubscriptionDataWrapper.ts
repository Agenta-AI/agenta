import {isDemo} from "./utils"

const DEFAULT_SUBSCRIPTION_STATE = {
    subscription: undefined,
    isSubLoading: false,
    mutateSubscription: () => undefined,
    error: undefined,
    isError: false,
    isSuccess: false,
} as const

export function useSubscriptionDataWrapper() {
    if (!isDemo()) {
        return DEFAULT_SUBSCRIPTION_STATE
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("@/agenta-oss-common/services/billing")
        return mod.useSubscriptionData()
    } catch {
        return DEFAULT_SUBSCRIPTION_STATE
    }
}
