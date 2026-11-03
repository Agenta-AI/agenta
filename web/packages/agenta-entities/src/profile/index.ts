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

/** Rename the signed-in user; resolves to the updated profile. */
export const updateUsername = async (username: string): Promise<User | null> => {
    const data = await getUsersClient().updateUserUsername({username})
    return safeParseWithLogging(userSchema, data, "[updateUsername]") ?? null
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

/**
 * The backend answers with the bare link, or with null when it emailed the link to the member
 * instead (a deployment with email enabled).
 */
const resetPasswordLinkSchema = z.string().nullable()

/**
 * Ask for a password reset for another member of the organization — an admin action, gated
 * server-side by the RESET_PASSWORD permission and refused outright for the organization owner.
 * Resolves to the one-time link, shown once and never returned again, or to null when the
 * backend emailed the link instead. A caller that gets null must say the email was sent.
 */
export const requestPasswordReset = async (userId: string): Promise<string | null> => {
    const data = await getUsersClient().resetUserPassword({user_id: userId})
    const parsed = safeParseWithLogging(resetPasswordLinkSchema, data, "[requestPasswordReset]")
    if (parsed === null && data !== null) {
        throw new Error("Received an unexpected response while generating the reset link.")
    }
    return parsed
}

/** Mint a reset link for another member. Throws when the backend sent no link (it emailed it). */
export const resetPassword = async (userId: string): Promise<string> => {
    const link = await requestPasswordReset(userId)
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
