export interface AgentaPasswordlessAttempt {
    deviceId: string
    preAuthSessionId: string
    flowType: string
    contactInfo?: string
    agentaApiUrl?: string
}

export type PasswordlessAttemptState =
    | {status: "none"}
    | {status: "clear"}
    | {status: "resume"; email: string}

export type PasswordlessAttemptSyncResult = PasswordlessAttemptState & {
    didClearAttempt?: boolean
}

interface SyncInitialPasswordlessAttemptInput {
    currentApiUrl: string
    getLoginAttemptInfo: () => Promise<AgentaPasswordlessAttempt | undefined>
    clearLoginAttemptInfo: () => Promise<void>
    onError?: (err: unknown) => void
}

export const getPasswordlessAttemptState = (
    attemptInfo: AgentaPasswordlessAttempt | undefined,
    currentApiUrl: string,
): PasswordlessAttemptState => {
    if (!attemptInfo) {
        return {status: "none"}
    }

    const isCurrentRegionAttempt = attemptInfo.agentaApiUrl === currentApiUrl
    const email = attemptInfo.contactInfo?.trim()

    if (isCurrentRegionAttempt && email) {
        return {status: "resume", email}
    }

    return {status: "clear"}
}

export const isSamePasswordlessAttempt = (
    first: AgentaPasswordlessAttempt | undefined,
    second: AgentaPasswordlessAttempt | undefined,
) => {
    if (!first || !second) return false

    return first.deviceId === second.deviceId && first.preAuthSessionId === second.preAuthSessionId
}

export const syncInitialPasswordlessAttempt = async ({
    currentApiUrl,
    getLoginAttemptInfo,
    clearLoginAttemptInfo,
    onError,
}: SyncInitialPasswordlessAttemptInput): Promise<PasswordlessAttemptSyncResult> => {
    try {
        const attemptInfo = await getLoginAttemptInfo()
        const attemptState = getPasswordlessAttemptState(attemptInfo, currentApiUrl)

        if (attemptState.status !== "clear") {
            return attemptState
        }

        const currentAttemptInfo = await getLoginAttemptInfo()

        if (isSamePasswordlessAttempt(attemptInfo, currentAttemptInfo)) {
            await clearLoginAttemptInfo()
            return {...attemptState, didClearAttempt: true}
        }

        return {...attemptState, didClearAttempt: false}
    } catch (err) {
        onError?.(err)
        return {status: "none"}
    }
}
