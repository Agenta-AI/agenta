import {ArrowRight} from "@phosphor-icons/react"
import {Button} from "antd"

import {STRIP_COPY} from "../assets/constants"

interface AgentIntentActionsProps {
    /** Create the agent from the composer's current text. */
    onCreate: () => void
    /** Create is in flight (e.g. committing the ephemeral) — spins the button and swaps its label. */
    loading?: boolean
}

/**
 * The trailing action cluster every "describe an agent" composer shares (home hero and the
 * playground onboarding composer), so the surfaces can't drift apart again.
 */
const AgentIntentActions = ({onCreate, loading}: AgentIntentActionsProps) => (
    <div className="flex items-center gap-2">
        <Button
            type="primary"
            icon={<ArrowRight size={14} />}
            iconPosition="end"
            loading={loading}
            onClick={onCreate}
            className="!shadow-none"
        >
            {loading ? STRIP_COPY.creatingAgent : STRIP_COPY.createAgent}
        </Button>
    </div>
)

export default AgentIntentActions
