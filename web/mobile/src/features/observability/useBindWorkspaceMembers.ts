import {useEffect} from "react"

import {bindWorkspaceMembersAtom, type WorkspaceMember} from "@agenta/entities/organization"
import {atom, useStore} from "jotai"
import {useRouter} from "next/router"

import {useSettingsOrg} from "../settings/useSettingsOrg"

const workspaceMembersListAtom = atom<WorkspaceMember[]>([])

/**
 * Names the annotation authors. Without a bound member list, an author shows as a raw user id.
 * This loads the workspace's members the way Settings does (the same query, so they are shared)
 * and hands them to the package's member seam. Call it only from code that loads lazily
 * (`TraceDrawerMembers` and the session drawer): the app shell must not carry the member query.
 */
export const useBindWorkspaceMembers = () => {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const members = useSettingsOrg(workspaceId).org.data?.default_workspace?.members
    const store = useStore()

    useEffect(() => {
        store.set(bindWorkspaceMembersAtom, workspaceMembersListAtom)
    }, [store])
    useEffect(() => {
        store.set(workspaceMembersListAtom, members ?? [])
    }, [store, members])
}
