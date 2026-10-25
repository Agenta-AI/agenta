import {useState} from "react"

import {AgentPrivacyControl} from "@agenta/entity-ui/sharing"

import {useAgentPrivacyProps, type AgentPrivacyHostOptions} from "./useAgentPrivacyProps"

/**
 * The agent's "Private" / "Shared" control in the playground top bar, wired to the sharing
 * state of the agent and the project's members.
 */
export const AgentPrivacyHost = (options: AgentPrivacyHostOptions) => {
    // The sharing state and the members are read when the panel opens.
    const [engaged, setEngaged] = useState(false)
    return (
        <AgentPrivacyControl
            {...useAgentPrivacyProps({...options, engaged})}
            onOpen={() => setEngaged(true)}
        />
    )
}
