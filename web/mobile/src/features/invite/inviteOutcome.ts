export const INVITE_JOINED_MESSAGE = "You joined a new workspace!"
export const INVITE_ALREADY_JOINED_MESSAGE = "You already joined this workspace."

const MESSAGE_BY_CODE: Record<string, string> = {
    INVITE_EMAIL_MISMATCH:
        "This invitation is not for you. Sign in with the invited account to accept it.",
    INVITE_EXPIRED: "This invitation has expired. Ask the workspace admin for a new one.",
    INVITE_NOT_FOUND: "This invitation is not valid. Ask the workspace admin for another one.",
}

const FALLBACK_MESSAGE =
    "This invitation may have expired, is no longer valid, or was sent to a different email address. Please check that you're signed in with the correct account, or request a new invitation from the workspace administrator."

export interface InviteFailure {
    alreadyAccepted: boolean
    message: string
    /** The request may succeed if sent again; a known invite error will not. */
    retryable: boolean
    /** Another attempt can still use the invite: a retry, or the invited account signing in. */
    keepInvite: boolean
}

interface AcceptError {
    response?: {data?: {detail?: unknown}}
}

/** What a failed accept request means for the person. */
export const inviteFailure = (error: unknown): InviteFailure => {
    const detail = (error as AcceptError | null)?.response?.data?.detail
    const code =
        detail && typeof detail === "object" ? (detail as {error?: unknown}).error : undefined
    if (code === "INVITE_ALREADY_ACCEPTED") {
        return {
            alreadyAccepted: true,
            message: INVITE_ALREADY_JOINED_MESSAGE,
            retryable: false,
            keepInvite: false,
        }
    }
    const known = typeof code === "string" ? MESSAGE_BY_CODE[code] : undefined
    return {
        alreadyAccepted: false,
        message: known ?? FALLBACK_MESSAGE,
        retryable: known === undefined,
        keepInvite: known === undefined || code === "INVITE_EMAIL_MISMATCH",
    }
}
