import {useEffect} from "react"

import {useAgentChannels} from "../agents/useAgentChannels"

/** Reports whether the agent answers in a connected channel; loaded on its own to keep channel code out. */
const AgentChannelPresence = ({
    agentId,
    onChange,
}: {
    agentId: string
    onChange: (hasChannel: boolean | undefined) => void
}) => {
    const {connections, loading, loadError} = useAgentChannels(agentId)
    const lists = connections.agentConnections
    const hasChannel =
        loading || loadError || !lists
            ? undefined
            : Object.values(lists).some((list) =>
                  list.some((connection) => connection.status === "connected"),
              )
    useEffect(() => onChange(hasChannel), [hasChannel, onChange])
    // Unknown again once it unmounts, until the next read answers.
    useEffect(() => () => onChange(undefined), [onChange])
    return null
}

export default AgentChannelPresence
