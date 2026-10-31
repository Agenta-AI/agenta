/**
 * `@agenta/entities/access`: what the signed-in person may do in the project on screen.
 *
 * Roles are enforced by the API; these atoms let a surface hide what the API would refuse.
 */
export {
    fetchProjectPermission,
    projectPermissionQueryKey,
    projectPermissionQueryPrefix,
} from "./api"

export {canViewSpansAtom, canViewSpansPendingAtom, projectPermissionAtomFamily} from "./state"
