import {useEffect} from "react"

import {startBlankSession} from "../chat/useStartBlankSession"

/** Forwards an in-app agent link to a blank playground session while the overview is off. */
export const AgentPlaygroundRedirect = ({base, agentId}: {base: string; agentId: string}) => {
    useEffect(() => {
        startBlankSession(base, agentId, "replace")
    }, [agentId, base])
    return null
}
