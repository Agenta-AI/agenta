/** Where the organization's plan stands for the live chat gate. */
export type LiveChatPlan = "free" | "paid" | "loading" | "unreadable"

/**
 * Live chat is for paid plans. It stays hidden while the plan loads, so Crisp never loads for
 * a free organization, and shows when the plan cannot be read, so a paying member never loses
 * it to a failed request. Without billing there is no plan to judge, so the deployment decides.
 */
export const liveChatAllowed = ({
    deploymentEnabled,
    billingEnabled,
    plan,
}: {
    deploymentEnabled: boolean
    billingEnabled: boolean
    plan: LiveChatPlan
}): boolean => {
    if (!deploymentEnabled) return false
    if (!billingEnabled) return true
    return plan === "paid" || plan === "unreadable"
}
