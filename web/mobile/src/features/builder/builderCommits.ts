import {isToolPart, partToolName} from "@agenta/chat/model"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ToolUIPart, UIMessage} from "ai"

/** The builder tool that saves a new version of another agent. */
const EDIT_AGENT_CONFIG = "edit_agent_config"

/** The fields this reads of an `edit_agent_config` result (builder-backend spec). */
interface EditAgentConfigResult {
    status?: unknown
    agent?: {id?: unknown}
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
 * The agents a builder saved a new version of in the loaded `messages`, from each
 * `edit_agent_config` result with status "committed" whose call is not in `seen`. Adds each
 * settled call to `seen`, so a call counts once. Any message can hold one: a reconnect loads
 * several turns at once, and a queued message can follow the answer that saved.
 */
export const takeCommittedAgentIds = (messages: UIMessage[], seen: Set<string>): string[] => {
    const agentIds = new Set<string>()
    for (const message of messages) {
        if (message.role !== "assistant") continue
        for (const part of message.parts) {
            if (!isToolPart(part.type)) continue
            const tool = part as ToolUIPart
            if (tool.state !== "output-available" || seen.has(tool.toolCallId)) continue
            if (canonicalClientToolName(partToolName(tool)) !== EDIT_AGENT_CONFIG) continue
            seen.add(tool.toolCallId)
            const result = parseResult(tool.output)
            const agentId = result?.agent?.id
            if (result?.status === "committed" && typeof agentId === "string" && agentId)
                agentIds.add(agentId)
        }
    }
    return [...agentIds]
}
