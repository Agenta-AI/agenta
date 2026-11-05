import type {WorkspaceMember} from "@agenta/entities/organization"
import {setUserAtoms} from "@agenta/entities/shared/user"
import {activeUserIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

/**
 * The members of the open workspace, once a screen that names people has loaded them
 * (`useBindWorkspaceMembers`). Empty until then: the app shell never loads them itself.
 */
export const workspaceMembersListAtom = atom<WorkspaceMember[]>([])

const currentUserAtom = atom((get) => {
    const id = get(activeUserIdAtom)
    return id ? {id} : null
})

/** Points the package's user lookup (`UserAuthorLabel`, "Created by") at the member list. */
export const bindUserLookup = () =>
    setUserAtoms({membersAtom: workspaceMembersListAtom, currentUserAtom})
