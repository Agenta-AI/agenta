import {useMemo} from "react"

import {sharingMemberRosterQueryAtom, type ProjectMemberProfile} from "@agenta/entities/sharing"
import {useAtomValue} from "jotai"

export interface AgentOwner {
    id: string
    name: string
}

/** The roster's people by name, the way the roster's rows and the Owner facet both need them. */
export const agentOwnersOf = (members: readonly ProjectMemberProfile[]) => {
    const owners: AgentOwner[] = []
    const ownerNames = new Map<string, string>()
    for (const member of members) {
        const id = member.user_id ? String(member.user_id) : ""
        if (!id) continue
        // Everyone by their own name, the reader included: "You" among named colleagues
        // makes one column say two different kinds of thing.
        const name = (member.name || member.email || "").trim()
        if (!name) continue
        ownerNames.set(id, name)
        owners.push({id, name})
    }
    owners.sort((a, b) => a.name.localeCompare(b.name))
    return {owners, ownerNames}
}

/**
 * Who can own an agent: the PROJECT's members, every page of them. An owner id the roster does
 * not hold is a former member, so the organization's roster is the wrong source: someone removed
 * from this project can still be in the organization.
 */
export const useAgentOwners = () => {
    // Project-scoped through the bound project atom, which both list screens bind.
    const roster = useAtomValue(sharingMemberRosterQueryAtom)
    return useMemo(() => agentOwnersOf(roster.data ?? []), [roster.data])
}
