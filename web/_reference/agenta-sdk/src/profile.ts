/**
 * Agenta TypeScript SDK — Profile manager.
 *
 * User profile operations.
 *
 * Mirrors:
 *   api/oss/src/routers/user_profile.py
 */

import type {AgentaClient} from "./client"
import type {UserProfile, UpdateUsernameRequest} from "./types"

export class Profile {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Fetch the current user's profile.
     *
     * GET /profile
     */
    async fetch(): Promise<UserProfile> {
        return this.client.request<UserProfile>("GET", "/profile", {legacy: true})
    }

    /**
     * Update the current user's username.
     *
     * PUT /profile/username
     */
    async updateUsername(username: string): Promise<UserProfile> {
        return this.client.request<UserProfile>("PUT", "/profile/username", {
            body: {username} satisfies UpdateUsernameRequest,
            legacy: true,
        })
    }
}
