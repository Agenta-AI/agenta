/**
 * Invite links land on the sign-in page carrying the org they invite into. The params have to
 * survive the round trip through a provider redirect, so the page stashes them before starting
 * any flow — this is the parse half of that, shared so every app stores the same shape.
 */
export interface InviteParams {
    token?: string
    organization_id?: string
    project_id?: string
    workspace_id?: string
    email?: string
}

export type QueryBag = Record<string, string | string[] | undefined>

/** Next's router hands array values for repeated params; the first one is the invite's. */
export const firstQueryValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value

/** The invite carried by `query`, or null when this is an ordinary visit. */
export function readInviteParams(query: QueryBag): InviteParams | null {
    const invite: InviteParams = {
        token: firstQueryValue(query.token),
        organization_id: firstQueryValue(query.organization_id),
        project_id: firstQueryValue(query.project_id),
        workspace_id: firstQueryValue(query.workspace_id),
        email: firstQueryValue(query.email),
    }
    return Object.values(invite).some(Boolean) ? invite : null
}
