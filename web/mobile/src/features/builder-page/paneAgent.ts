import {isToolPart, partToolName} from "@agenta/chat/model"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ToolUIPart, UIMessage} from "ai"

import {builderChatsKey} from "../builder/builderChatLink"

import {sentContextOf} from "./sentContext"

/** An agent as the builder page names it. The name is empty when the source gives none. */
export interface AgentRef {
    id: string
    name: string
}

/** A builder tab key in the address: `?tab=<kind>:<id>`. */
export type BuilderTabKind = "agent" | "automation" | "tool" | "app"
export interface BuilderTabRef {
    kind: BuilderTabKind
    id: string
}

const TAB_KINDS: readonly BuilderTabKind[] = ["agent", "automation", "tool", "app"]

/** `agent:<id>` and the other kinds, or null for anything else. */
export const parseTabParam = (value: unknown): BuilderTabRef | null => {
    if (typeof value !== "string") return null
    const at = value.indexOf(":")
    if (at <= 0) return null
    const kind = value.slice(0, at) as BuilderTabKind
    const id = value.slice(at + 1)
    return TAB_KINDS.includes(kind) && id ? {kind, id} : null
}

export const tabParam = (ref: BuilderTabRef) => `${ref.kind}:${ref.id}`

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

/** The agent of the latest settled `create_agent` or `edit_agent_config` result, or null. */
export const latestResultAgent = (messages: readonly UIMessage[]): AgentRef | null => {
    for (let m = messages.length - 1; m >= 0; m--) {
        const message = messages[m]
        if (message.role !== "assistant") continue
        for (let p = message.parts.length - 1; p >= 0; p--) {
            const agent = agentOfToolPart(message.parts[p])
            if (agent) return agent
        }
    }
    return null
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

/**
 * The agent this browser linked the chat to (design D12): the agent whose builder chats hold
 * `sessionId`. Null when none does or when storage cannot be read.
 */
export const linkedAgentId = (
    userId: string,
    projectId: string,
    sessionId: string,
): string | null => {
    try {
        const parsed: unknown = JSON.parse(
            window.localStorage.getItem(builderChatsKey(userId, projectId)) ?? "{}",
        )
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
        for (const [agentId, ids] of Object.entries(parsed)) {
            if (Array.isArray(ids) && ids.includes(sessionId)) return agentId
        }
    } catch {
        // Storage refused or not JSON: no link.
    }
    return null
}

/**
 * The agent of the pane's agent tab, in this order: the agent tab in the address, the latest
 * typed tool result of the chat, the page context of the chat, the browser link. Null: no pane.
 * The page writes the agent it shows into the address, so once a chat shows an agent, a result
 * for another agent does not replace it; the builder tabs (section 40) open that agent beside it.
 */
export const paneAgentId = ({
    tab,
    resultAgent,
    contextAgent,
    linkedAgent,
}: {
    tab: BuilderTabRef | null
    resultAgent: AgentRef | null
    contextAgent: AgentRef | null
    linkedAgent: string | null
}): string | null => {
    if (tab?.kind === "agent") return tab.id
    return resultAgent?.id ?? contextAgent?.id ?? linkedAgent ?? null
}
