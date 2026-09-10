import {getUsersClient} from "@agenta/sdk/resources"
import type {User} from "@agenta/shared/types"
import {useQuery} from "@tanstack/react-query"
import {z} from "zod"

import {safeParseWithLogging} from "../shared"

/**
 * Fern types `/profile` as `unknown` (the backend allows extra fields), so the shape is pinned
 * here. Validation at the boundary is what turns that `unknown` into a `User`.
 */
const userSchema = z.object({
    id: z.string(),
    uid: z.string(),
    username: z.string(),
    email: z.string(),
    // Optional so a response without it still validates: this is the only field the schema
    // lets through that nothing renders — `state/classicMode` reads it to tell whether an
    // account predates the simplified experience, on any device rather than only the one it
    // signed up on.
    created_at: z.string().optional(),
})

/** Fern stashes the HTTP status on the thrown `AgentaApiError` as `statusCode`. */
const isUnauthorized = (error: unknown): boolean =>
    (error as {statusCode?: number} | null)?.statusCode === 401

/** GET the signed-in user, or null when the response does not describe one. */
export const fetchProfile = async (): Promise<User | null> => {
    const data = await getUsersClient().fetchUserProfile()
    return safeParseWithLogging(userSchema, data, "[fetchProfile]") ?? null
}

/**
 * Permanently delete the signed-in account (an EE capability). Removes the user and the
 * organizations they own — with every workspace, project and application inside them — from
 * the database, the auth provider, Stripe and the mailing list. Irreversible; the caller is
 * expected to sign out once it resolves.
 */
export const deleteAccount = async (): Promise<void> => {
    await getUsersClient().deleteUserAccount()
}

/** The backend answers with the bare link, so the schema is the string itself. */
const resetPasswordLinkSchema = z.string()

/**
 * Mint a password reset link for another member of the organization — an admin action, gated
 * server-side by the RESET_PASSWORD permission and refused outright for the organization owner.
 * The link is shown once and never returned again, so the caller must surface it immediately.
 */
export const resetPassword = async (userId: string): Promise<string> => {
    const data = await getUsersClient().resetUserPassword({user_id: userId})
    const link = safeParseWithLogging(resetPasswordLinkSchema, data, "[resetPassword]")
    if (link === null) {
        throw new Error("Received an unexpected response while generating the reset link.")
    }
    return link
}

export interface UseProfileOptions {
    /** Skip the request until the host knows a session exists. */
    enabled?: boolean
}

/**
 * The signed-in user, for surfaces that just need to show who you are.
 *
 * Deliberately thinner than the desktop's profile atom, which additionally persists to disk,
 * gates a fanout and redirects on failure — app concerns. A 401 resolves to `null` (signed
 * out) rather than throwing, so a host can render a signed-out state without a error boundary.
 */
export const useProfile = ({enabled = true}: UseProfileOptions = {}) => {
    const query = useQuery<User | null>({
        queryKey: ["profile"],
        queryFn: async () => {
            try {
                return await fetchProfile()
            } catch (error) {
                if (isUnauthorized(error)) return null
                throw error
            }
        },
        enabled,
        staleTime: 60_000,
    })

    return {user: query.data ?? null, isPending: query.isPending, error: query.error}
}
