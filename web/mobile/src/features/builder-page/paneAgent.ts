import {isToolPart, partToolName} from "@agenta/chat/model"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ToolUIPart, UIMessage} from "ai"

import {sentContextOf} from "../builder/pageContext"

/** An agent as the builder page names it. The name is empty when the source gives none. */
export interface AgentRef {
    id: string
    name: string
}

/** The builder tools whose result names the agent they created or saved. */
const AGENT_RESULT_TOOLS = new Set(["create_agent", "edit_agent_config"])

/** The result fields read here (builder-backend spec, task 9.3). */
interface AgentToolResult {
    status?: unknown
    agent?: {id?: unknown; name?: unknown}
}

const parseResult = (output: unknown): AgentToolResult | null => {
    let value = output
    if (typeof value === "string") {
        try {
            value = JSON.parse(value)
        } catch {
            return null
        }
    }
    return value && typeof value === "object" ? (value as AgentToolResult) : null
}

/** The agent of one settled `create_agent` or `edit_agent_config` call, or null. */
export const agentOfToolPart = (part: UIMessage["parts"][number]): AgentRef | null => {
    if (!isToolPart(part.type)) return null
    const tool = part as ToolUIPart
    if (tool.state !== "output-available") return null
    if (!AGENT_RESULT_TOOLS.has(canonicalClientToolName(partToolName(tool)))) return null
    const result = parseResult(tool.output)
    const id = result?.agent?.id
    // A refusal carries no agent; a denied call has no output.
    if (typeof id !== "string" || !id) return null
    const name = typeof result?.agent?.name === "string" ? result.agent.name : ""
    return {id, name}
}

/** One settled `create_agent` or `edit_agent_config` call that names an agent. */
export interface AgentResult {
    toolCallId: string
    agent: AgentRef
    /** True when the call saved a new version or created the agent ("committed", "created"). */
    saved: boolean
}

/** Every settled `create_agent` and `edit_agent_config` call that names an agent, in order. */
export const agentResults = (messages: readonly UIMessage[]): AgentResult[] => {
    const results: AgentResult[] = []
    for (const message of messages) {
        if (message.role !== "assistant") continue
        for (const part of message.parts) {
            const agent = agentOfToolPart(part)
            if (!agent) continue
            const tool = part as ToolUIPart
            const status = parseResult(tool.output)?.status
            results.push({
                toolCallId: tool.toolCallId,
                agent,
                saved: status === "committed" || status === "created",
            })
        }
    }
    return results
}

/** The agent of the latest user message that carries a page context line, or null. */
export const latestContextAgent = (messages: readonly UIMessage[]): AgentRef | null => {
    for (let m = messages.length - 1; m >= 0; m--) {
        const message = messages[m]
        if (message.role !== "user") continue
        const agent = sentContextOf(message)?.agent
        if (agent?.id) return {id: agent.id, name: agent.name ?? ""}
    }
    return null
}
