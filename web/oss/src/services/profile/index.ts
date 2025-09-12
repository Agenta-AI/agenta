// web/oss/src/services/profile/index.ts
/**
 * Profile Service - Modern fetchJson Implementation
 *
 * Aligned with working patterns from projects, variants, and revisions.
 * Uses standard fetchJson for consistency and reliability.
 */

import {fetchJson, getBaseUrl} from "../../lib/api/assets/fetchClient"
import {User} from "../../lib/Types"

/**
 * Fetch user profile using modern fetchJson
 * Replaces the old axios-based fetchProfile
 */
export const fetchProfile = async (): Promise<User> => {
    const base = getBaseUrl()
    const url = new URL("api/profile", base)

    console.log("🔍 Profile fetcher debug:", {
        base,
        url: url.toString(),
    })

    try {
        console.log("🚀 Calling fetchJson with URL:", url.toString())
        const data = await fetchJson(url)
        console.log("✅ Profile fetcher success:", {
            username: data?.username,
            email: data?.email,
        })
        return data
    } catch (error: any) {
        console.error("❌ Profile fetcher failed:", {
            message: error?.message,
            status: error?.status,
            statusText: error?.statusText,
            url: url.toString(),
            stack: error?.stack?.split("\n").slice(0, 3).join("\n"),
        })
        throw error
    }
}

/**
 * Update user profile via REST
 * Returns an axios-like object with `data` for compatibility
 */
export const updateProfile = async (
    payload: Partial<Pick<User, "username" | "email" | "avatar">> & {
        preferences?: Record<string, any>
    },
): Promise<{data: User}> => {
    const base = getBaseUrl()
    const url = new URL("api/profile", base)
    const data = await fetchJson(url, {
        method: "PUT",
        body: JSON.stringify(payload),
    })
    return {data}
}

/**
 * Change user password via REST
 * OSS note: backend may restrict direct password change; this endpoint is
 * structured for compatibility and can be wired to the appropriate route.
 */
export const changePassword = async (payload: {
    currentPassword: string
    newPassword: string
}): Promise<void> => {
    const base = getBaseUrl()
    // Prefer an auth-scoped route; adjust if backend differs
    const url = new URL("api/auth/change-password", base)
    await fetchJson(url, {
        method: "POST",
        body: JSON.stringify(payload),
    })
}
