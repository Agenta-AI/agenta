/**
 * Workspace Service - Modern fetchJson Implementation
 *
 * Aligned with working patterns from projects, variants, and revisions.
 * Uses standard fetchJson for consistency and reliability.
 */

import {fetchJson, getBaseUrl} from "../../lib/api/assets/fetchClient"
import {WorkspaceMember} from "../../lib/Types"

/**
 * Fetch all workspace members for a given workspace
 */
export const fetchWorkspaceMembers = async (workspaceId: string): Promise<WorkspaceMember[]> => {
    const base = getBaseUrl()
    const url = new URL(`api/workspaces/${workspaceId}/members`, base)

    console.log("🔍 Workspace members fetcher debug:", {base, url: url.toString(), workspaceId})

    try {
        console.log("🚀 Calling fetchJson with URL:", url.toString())
        const data = await fetchJson(url)
        console.log("✅ Workspace members fetcher success:", {
            count: data?.length || 0,
            data: data?.slice(0, 2), // Show first 2 members for debugging
        })
        return data || []
    } catch (error) {
        console.error("❌ Workspace members fetcher failed:", {
            message: error?.message,
            status: error?.status,
            statusText: error?.statusText,
            url: url.toString(),
            stack: error?.stack?.split("\n").slice(0, 3).join("\n"),
        })
        return []
    }
}
