import {AGENT_NEEDS_SETUP_CODE, invalidateAgentRequirements} from "@agenta/entities/workflow"

/** A run refused for needs-setup means the tags are stale: ask the server again. */
export const refreshOnSetupFailure = (code: string | null | undefined): void => {
    if (code === AGENT_NEEDS_SETUP_CODE) void invalidateAgentRequirements()
}
