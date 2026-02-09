/**
 * User Resolution Atoms
 *
 * Configurable atoms for resolving user IDs to user information.
 * These atoms are configured at app initialization with the actual data source.
 */

import {useMemo} from "react"

import {atom, useAtomValue, type Atom} from "jotai"
import {atomFamily} from "jotai-family"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal user information for display purposes
 */
export interface UserInfo {
    id: string
    username?: string | null
    name?: string | null
    email?: string | null
}

/**
 * Workspace member structure (matches the app's WorkspaceMember type)
 */
interface WorkspaceMember {
    user: {
        id?: string
        username?: string
        name?: string
        email?: string
    }
}

/**
 * Configuration for user atoms
 */
export interface UserAtomConfig {
    /**
     * Atom that provides the list of workspace/org members.
     * Each member should have a `user` property with id, username, name, email.
     */
    membersAtom: Atom<WorkspaceMember[]>

    /**
     * Atom that provides the current logged-in user.
     */
    currentUserAtom: Atom<UserInfo | null>
}

// ============================================================================
// STATE
// ============================================================================

let atomConfig: UserAtomConfig | null = null

// Fallback atoms when not configured
const emptyMembersAtom = atom<WorkspaceMember[]>([])

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configure the user resolution atoms with actual data sources.
 * This should be called during app initialization.
 *
 * @example
 * ```typescript
 * import { setUserAtoms } from '@agenta/entities/shared'
 * import { workspaceMembersAtom } from '@/oss/state/workspace'
 * import { userAtom } from '@/oss/state/profile'
 *
 * setUserAtoms({
 *   membersAtom: workspaceMembersAtom,
 *   currentUserAtom: userAtom,
 * })
 * ```
 */
export function setUserAtoms(config: UserAtomConfig): void {
    atomConfig = config
}

// ============================================================================
// ATOMS
// ============================================================================

/**
 * Atom that provides the current user
 */
export const currentUserAtom = atom<UserInfo | null>((get) => {
    if (!atomConfig) return null
    return get(atomConfig.currentUserAtom)
})

/**
 * Atom family to resolve a user ID to user information.
 * Returns UserInfo if found, null otherwise.
 */
export const userByIdFamily = atomFamily((userId: string | null | undefined) =>
    atom<UserInfo | null>((get) => {
        if (!userId) return null

        // Get members from configured atom
        const membersAtom = atomConfig?.membersAtom ?? emptyMembersAtom
        const members = get(membersAtom)

        // Find member by user ID
        const idStr = String(userId)
        const member = members.find((m) => String(m.user?.id ?? "") === idStr)

        if (!member?.user) return null

        return {
            id: String(member.user.id ?? userId),
            username: member.user.username ?? null,
            name: member.user.name ?? null,
            email: member.user.email ?? null,
        }
    }),
)

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Resolves the display name for a user ID.
 * Returns username, name, or email (in that order of preference).
 * Returns null if user not found.
 */
export function useUserDisplayName(userId: string | null | undefined): string | null {
    const userAtom = useMemo(() => userByIdFamily(userId), [userId])
    const user = useAtomValue(userAtom)

    if (!user) return null

    const candidate = user.username ?? user.name ?? user.email
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null
}

/**
 * Check if a user ID matches the current logged-in user
 */
export function useIsCurrentUser(userId: string | null | undefined): boolean {
    const currentUser = useAtomValue(currentUserAtom)
    const userAtom = useMemo(() => userByIdFamily(userId), [userId])
    const user = useAtomValue(userAtom)

    if (!currentUser || !userId) return false

    // Check by ID
    if (currentUser.id && String(currentUser.id) === String(userId)) {
        return true
    }

    // Check by username/email match
    const normalize = (val: string | null | undefined): string | null =>
        typeof val === "string" && val.trim().length ? val.trim().toLowerCase() : null

    const currentUsername = normalize(currentUser.username)
    const currentEmail = normalize(currentUser.email)
    const userUsername = normalize(user?.username)
    const userEmail = normalize(user?.email)

    if (currentUsername && userUsername && currentUsername === userUsername) {
        return true
    }
    if (currentEmail && userEmail && currentEmail === userEmail) {
        return true
    }

    return false
}
