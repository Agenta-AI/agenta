/**
 * The parts of Advanced that apply to an agent: Execution (more than one sandbox), Agenta tools
 * (the deployment offers some) and Build kit (the playground adds one). The Advanced section and
 * the Advanced view both read this, so a part shows in the list exactly when the row shows.
 */
import type {SchemaProperty} from "@agenta/entities/shared"

import {useAgentaToolsData} from "./AgentaToolsSection"
import {useSandboxChoice} from "./sandboxChoice"
import {useBuildKit} from "./useBuildKit"

export const useAdvancedParts = (
    schema: SchemaProperty | null | undefined,
    config: Record<string, unknown>,
    revisionId: string | null,
) => {
    const sandbox = useSandboxChoice(schema, config)
    const agentaTools = useAgentaToolsData(config, revisionId)
    const {hasBuildKitOverlay} = useBuildKit({revisionId})
    const execution = sandbox.hasExecutionGroup
    const tools = agentaTools.status !== "none"
    return {
        sandbox,
        agentaTools,
        execution,
        tools,
        buildKit: hasBuildKitOverlay,
        any: execution || tools || hasBuildKitOverlay,
    }
}
