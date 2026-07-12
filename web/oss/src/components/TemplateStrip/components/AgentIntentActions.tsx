import {ArrowRight, Terminal} from "@phosphor-icons/react"
import {Button} from "antd"

import {STRIP_COPY} from "../assets/constants"

interface AgentIntentActionsProps {
    /** Create the agent from the composer's current text. */
    onCreate: () => void
    /** Copy the coding-agent install command + current text to the clipboard. */
    onCodingAgentCopy: () => void
    /** Create is in flight (e.g. committing the ephemeral) — shows the button spinner. */
    creating?: boolean
}

/**
 * The trailing action cluster every "describe an agent" composer shares (home hero and the
 * playground onboarding composer), so the surfaces can't drift apart again.
 */
const AgentIntentActions = ({onCreate, onCodingAgentCopy, creating}: AgentIntentActionsProps) => (
    <div className="flex items-center gap-2">
        <Button icon={<Terminal size={15} />} onClick={onCodingAgentCopy} className="!shadow-none">
            {STRIP_COPY.useCodingAgent}
        </Button>
        <Button
            type="primary"
            icon={<ArrowRight size={14} />}
            iconPosition="end"
            loading={creating}
            onClick={onCreate}
            className="!shadow-none"
        >
            {STRIP_COPY.createAgent}
        </Button>
    </div>
)

export default AgentIntentActions
