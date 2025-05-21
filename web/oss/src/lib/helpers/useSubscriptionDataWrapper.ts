export function useSubscriptionDataWrapper() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("@/agenta-oss-common/services/billing")
        return mod.useSubscriptionData()
    } catch {
        return {subscription: undefined}
    }
}
