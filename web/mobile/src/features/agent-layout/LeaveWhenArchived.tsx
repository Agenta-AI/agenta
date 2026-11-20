import {useEffect, useState} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

/**
 * Moves the screen to the Agents list once the agent is gone from the agent list, which is what
 * a confirmed archive does. Mounted only after Archive is picked, so the session screen does not
 * load the agent list for it. The route change also shows the main sidebar.
 */
export const LeaveWhenArchived = ({agentId, base}: {agentId: string; base: string}) => {
    const router = useRouter()
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const listed = (agents.data ?? []).some((agent) => agent.id === agentId)
    // Only an agent this list has shown can leave it: an agent it never lists (a list still
    // loading, or one it does not cover) must not move the screen before the archive.
    const [seen, setSeen] = useState(false)
    useEffect(() => {
        if (listed) setSeen(true)
    }, [listed])
    const gone = seen && !listed && !agents.isPending && !agents.isError
    useEffect(() => {
        if (gone) void router.push(`${base}/agents`)
    }, [gone, base, router])
    return null
}
