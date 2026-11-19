import {isToolPart, partToolName} from "@agenta/chat/model"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ToolUIPart, UIMessage} from "ai"

/** The builder tool that saves a new version of another agent. */
const EDIT_AGENT_CONFIG = "edit_agent_config"

/** The result of `edit_agent_config` (builder-backend spec): the agent and its new revision. */
interface EditAgentConfigResult {
    status?: unknown
    agent?: {id?: unknown}
    revision?: {id?: unknown; version?: unknown}
}

const parseResult = (output: unknown): EditAgentConfigResult | null => {
    let value = output
    if (typeof value === "string") {
        try {
            value = JSON.parse(value)
        } catch {
            return null
        }
    }
    return value && typeof value === "object" ? (value as EditAgentConfigResult) : null
}

/**
 * The agents a builder saved a new version of in `message`, from each `edit_agent_config` result
 * with status "committed" not yet in `seen`. Records each call in `seen`, so each counts once.
 */
export const takeBuilderCommits = (message: UIMessage, seen: Set<string>): string[] => {
    const agentIds: string[] = []
    for (const part of message.parts) {
        if (!isToolPart(part.type)) continue
        const tool = part as ToolUIPart
        if (tool.state !== "output-available" || seen.has(tool.toolCallId)) continue
        if (canonicalClientToolName(partToolName(tool)) !== EDIT_AGENT_CONFIG) continue
        seen.add(tool.toolCallId)
        const result = parseResult(tool.output)
        const agentId = result?.agent?.id
        if (result?.status !== "committed" || typeof agentId !== "string" || !agentId) continue
        if (typeof result.revision?.id !== "string") continue
        if (!agentIds.includes(agentId)) agentIds.push(agentId)
    }
    return agentIds
}
