import {useState} from "react"

import {AgentPrivacyControl, AgentPrivacyPanel} from "@agenta/entity-ui/sharing"

import {useAgentPrivacyProps, type AgentPrivacyHostOptions} from "./useAgentPrivacyProps"

/**
 * The agent's "Private" / "Shared" control in the playground top bar, wired to the sharing
 * state of the agent and the project's members.
 */
export const AgentPrivacyHost = ({
    onEngage,
    ...options
}: AgentPrivacyHostOptions & {onEngage?: () => void}) => {
    // The sharing state and the members are read when the panel opens.
    const [engaged, setEngaged] = useState(false)
    return (
        <AgentPrivacyControl
            {...useAgentPrivacyProps({...options, engaged})}
            onOpen={() => {
                setEngaged(true)
                onEngage?.()
            }}
        />
    )
}

/**
 * The same privacy and owner content in place, for the Access tab of the agent: who can see it,
 * the owner and "Transfer ownership". It reads the sharing state and the members at once.
 */
export const AgentAccessPanel = (options: AgentPrivacyHostOptions) => (
    <AgentPrivacyPanel {...useAgentPrivacyProps({...options, engaged: true})} active />
)
