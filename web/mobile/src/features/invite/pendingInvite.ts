import type {InviteParams} from "@agenta/auth"

/** The five values the emailed invite link always carries. */
export type PendingInvite = Required<InviteParams>

const PENDING_INVITE_KEY = "agenta:mobile:pending-invite"
/** Long enough to sign up and verify an email; the emailed link stays valid for days. */
const PENDING_INVITE_TTL_MS = 30 * 60 * 1000

const isComplete = (invite: InviteParams): invite is PendingInvite =>
    Boolean(
        invite.token &&
        invite.email &&
        invite.organization_id &&
        invite.workspace_id &&
        invite.project_id,
    )

/** Keeps an invite through sign-in. The trip through `/auth` and a provider drops the query. */
export function rememberInvite(invite: InviteParams, now = Date.now()): void {
    if (!isComplete(invite)) return
    try {
        localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({invite, capturedAt: now}))
    } catch {
        // storage unavailable (private mode / quota): the person opens the link again after sign-in
    }
}

/** The kept invite, or null when none is kept or its window has passed. */
export function readPendingInvite(now = Date.now()): PendingInvite | null {
    try {
        const raw = localStorage.getItem(PENDING_INVITE_KEY)
        const parsed = raw
            ? (JSON.parse(raw) as {invite?: InviteParams; capturedAt?: unknown})
            : null
        if (
            parsed?.invite &&
            typeof parsed.capturedAt === "number" &&
            now - parsed.capturedAt <= PENDING_INVITE_TTL_MS &&
            isComplete(parsed.invite)
        ) {
            return parsed.invite
        }
        return null
    } catch {
        return null
    }
}

export function forgetInvite(): void {
    try {
        localStorage.removeItem(PENDING_INVITE_KEY)
    } catch {
        // storage unavailable: nothing was kept
    }
}
