import {useMemo} from "react"

import {fetchSingleOrg} from "@agenta/entities/organization"
import {useQuery} from "@tanstack/react-query"

import {useCurrentProject} from "../context/useCurrentProject"

export interface AgentOwner {
    id: string
    name: string
}

/**
 * Who can have created an agent — the org's member roster, named the way the roster's rows and
 * the Created by facet both need it.
 *
 * The roster lives on the org's default workspace, not behind a members endpoint, and the
 * settings screen already reads it under this exact key: arriving here from Settings costs no
 * request, and the two surfaces cannot disagree about a name.
 */
export const useAgentOwners = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const project = useCurrentProject(workspaceId, projectId)
    const organizationId = project?.organization_id ?? null

    const org = useQuery({
        queryKey: ["selectedOrg", organizationId],
        queryFn: () => fetchSingleOrg({organizationId: organizationId!}),
        enabled: Boolean(organizationId),
        staleTime: 60_000,
    })

    return useMemo(() => {
        const members = org.data?.default_workspace?.members ?? []
        const owners: AgentOwner[] = []
        const ownerNames = new Map<string, string>()

        for (const member of members) {
            const id = member.user?.id ? String(member.user.id) : ""
            if (!id) continue
            // Everyone by their own name, the reader included: "You" among named colleagues
            // makes one column say two different kinds of thing.
            const name = (member.user.username || member.user.email || "").trim()
            if (!name) continue
            ownerNames.set(id, name)
            owners.push({id, name})
        }

        owners.sort((a, b) => a.name.localeCompare(b.name))

        return {owners, ownerNames}
    }, [org.data])
}
