import {useEffect} from "react"

import {bindWorkspaceMembersAtom, type WorkspaceMember} from "@agenta/entities/organization"
import {atom, useStore} from "jotai"
import {useRouter} from "next/router"

import {useSettingsOrg} from "../../settings/useSettingsOrg"

const sessionDrawerMembersAtom = atom<WorkspaceMember[]>([])

/**
 * Names the annotation authors. /m binds no member list, so an author shows as a raw user id.
 * The drawer loads the workspace's members the way Settings does (the same query, so they are
 * shared) and hands them to the package's member seam. It runs in the drawer's chunk, so the
 * traces page does not carry it.
 */
export const useSessionDrawerMembers = () => {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const members = useSettingsOrg(workspaceId).org.data?.default_workspace?.members
    const store = useStore()

    useEffect(() => {
        store.set(bindWorkspaceMembersAtom, sessionDrawerMembersAtom)
    }, [store])
    useEffect(() => {
        store.set(sessionDrawerMembersAtom, members ?? [])
    }, [store, members])
}
