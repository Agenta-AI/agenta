import type {SessionStream} from "@agenta/entities/session"

/**
 * Whether the session is private to the reader: they own it, it is private, no other person
 * holds a `participant` grant, and no other session started it. The server applies a person's
 * builder approval choice only in such a session (`resolve_gate`, basis `approval_choice`).
 * False while the row or its sharing state is unknown. The owner is the only reader the row
 * lists the grants to.
 */
export const isPrivateToViewer = (row: SessionStream | null | undefined): boolean => {
    const sharing = row?.sharing
    if (!sharing || row.origin === "calling_session") return false
    if (sharing.my_role !== "owner" || sharing.policy.visibility !== "private") return false
    const owner = sharing.policy.owner_user_id
    return !sharing.grants.some((grant) => grant.role === "participant" && grant.user_id !== owner)
}
