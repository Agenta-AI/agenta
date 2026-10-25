import {AgentPrivacyDialog} from "@agenta/entity-ui/sharing"

import {useAgentPrivacyProps, type AgentPrivacyHostOptions} from "./useAgentPrivacyProps"

/**
 * "Privacy and owner" on its own, for the channel screens' Share links. Mount it only while it
 * is open: it reads the agent's sharing state.
 */
export const AgentPrivacyDialogHost = ({
    onClose,
    ...options
}: AgentPrivacyHostOptions & {onClose: () => void}) => (
    <AgentPrivacyDialog
        {...useAgentPrivacyProps(options)}
        open
        onOpenChange={(open) => !open && onClose()}
    />
)
