import {getAccessClient} from "@agenta/sdk/resources"

/**
 * Does the signed-in person hold `action` in `projectId`?
 *
 * The backend answers with a status, not a body: it allows the call or refuses it. Any failure,
 * a refusal and a network error alike, reads as "no", so a control gated on this stays hidden
 * rather than opening a screen whose every request the API would refuse.
 */
export const fetchProjectPermission = async (
    projectId: string,
    action: string,
): Promise<boolean> => {
    try {
        await getAccessClient().checkPermissions(
            {
                action,
                scope_type: "project",
                scope_id: projectId,
                resource_type: "service",
            },
            // Match auth scope to scope_id; session auth otherwise selects the default project.
            {queryParams: {project_id: projectId}},
        )
        return true
    } catch {
        return false
    }
}

/** The key prefix of every permission answer; invalidate it when the reader's role changes. */
export const projectPermissionQueryPrefix = ["project-permission"] as const

/** One cache entry per project and action, shared by the app hook and the package atoms. */
export const projectPermissionQueryKey = (projectId: string, action: string) => [
    ...projectPermissionQueryPrefix,
    projectId,
    action,
]
