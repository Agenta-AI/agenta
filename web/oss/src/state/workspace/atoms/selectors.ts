import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {WorkspaceMember} from "@/oss/lib/Types"

import {selectedOrgAtom} from "../../org/selectors/org"

/**
 * Atom for the search term used to filter workspace members
 */
export const memberSearchTermAtom = atom<string>("")

/**
 * Derived atom that provides all workspace members
 */
export const workspaceMembersAtom = atom<WorkspaceMember[]>((get) => {
    const selectedOrg = get(selectedOrgAtom)
    return selectedOrg?.default_workspace?.members || []
})

/**
 * Derived atom that provides filtered workspace members based on search term
 */
export const filteredWorkspaceMembersAtom = atom<WorkspaceMember[]>((get) => {
    const members = get(workspaceMembersAtom)
    const searchTerm = get(memberSearchTermAtom)

    if (!searchTerm.trim()) {
        return members
    }

    return members.filter((member) =>
        member.user.email.toLowerCase().includes(searchTerm.toLowerCase()),
    )
})

/**
 * Atom family to access a workspace member by user ID
 * Returns the WorkspaceMember for the given user id, or a fallback with null username if not found
 */
export const workspaceMemberByIdFamily = atomFamily((userId: string | null | undefined) =>
    atom<WorkspaceMember | null>((get) => {
        const members = get(workspaceMembersAtom)
        if (!userId) return null
        const idStr = String(userId)
        const found = members.find((m) => String(m.user?.id ?? "") === idStr)
        if (found) return found

        // Return a fallback member when not found (e.g., demo org with no members loaded).
        // Username is null so that downstream ?? chains can fall through to better alternatives
        // (e.g., creator name from run data) before reaching a final "User" display fallback.
        return {
            user: {
                id: idStr,
                email: "",
                username: "",
                status: "member",
                created_at: "",
            },
            roles: [],
        }
    }),
)
