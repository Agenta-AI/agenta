/**
 * Shared User Resolution System
 *
 * Provides a configurable user resolution system that can be used across all entities.
 * The system uses atoms that are configured at app initialization with the actual
 * user data source (workspace members, org members, etc.)
 *
 * ## Usage
 *
 * 1. Configure the user atoms during app initialization:
 * ```typescript
 * import { setUserAtoms } from '@agenta/entities/shared'
 *
 * setUserAtoms({
 *   membersAtom: workspaceMembersAtom,
 *   currentUserAtom: userAtom,
 * })
 * ```
 *
 * 2. Use the user resolution atoms in components:
 * ```typescript
 * import { userByIdFamily, useUserDisplayName } from '@agenta/entities/shared'
 *
 * // In a component
 * const user = useAtomValue(userByIdFamily(userId))
 * const displayName = useUserDisplayName(userId)
 * ```
 *
 * 3. Use the UserAuthorLabel component for author display:
 * ```typescript
 * import { UserAuthorLabel } from '@agenta/entities/shared'
 *
 * <UserAuthorLabel userId={authorId} />
 * ```
 *
 * @module shared/user
 */

export {
    // Configuration
    setUserAtoms,
    // Atoms
    userByIdFamily,
    currentUserAtom,
    // Hooks
    useUserDisplayName,
    useIsCurrentUser,
    // Types
    type UserAtomConfig,
    type UserInfo,
} from "./atoms"

export {UserAuthorLabel, type UserAuthorLabelProps} from "./UserAuthorLabel"
