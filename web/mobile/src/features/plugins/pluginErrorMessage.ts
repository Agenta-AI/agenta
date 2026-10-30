/** Services can wrap a downstream gateway refusal in a failed invocation envelope. */
export function pluginErrorMessage(error: unknown): string {
    const response = (error as {response?: {status?: number; data?: {status?: {message?: string}}}})
        ?.response
    const message =
        response?.data?.status?.message ??
        (error instanceof Error ? error.message : "Plugin action failed.")
    if (
        response?.status === 401 ||
        response?.status === 403 ||
        message.includes("policy_denied") ||
        /HTTP (401|403)\b/.test(message)
    ) {
        return "Access denied. You do not have permission to run this plugin or use one of its connections."
    }
    return message
}
