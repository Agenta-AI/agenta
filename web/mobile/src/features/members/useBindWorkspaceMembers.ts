import {useEffect} from "react"

import {bindWorkspaceMembersAtom} from "@agenta/entities/organization"
import {useStore} from "jotai"
import {useRouter} from "next/router"

import {useSettingsOrg} from "../settings/useSettingsOrg"

import {bindUserLookup, workspaceMembersListAtom} from "./workspaceMembersListAtom"

// The package's user lookup reads its source when a label first renders. Every screen that shows
// a "Created by" imports this file, so the lookup is bound before any of its labels render, and
// the app shell carries none of it.
bindUserLookup()

/**
 * Names people: annotation authors and every "Created by". Without the member list, an author
 * shows as a raw user id or a dash. This loads the workspace's members the way Settings does (the
 * same query, so all screens share one request) and hands them to the package's member seams.
 * Call it from screens and drawers that name people, never from the app shell: the shell must
 * not carry the member query.
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
