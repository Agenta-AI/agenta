import {canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ToolUIPart, UIMessage} from "ai"

import {isToolPart, partToolName} from "./parts"

/** A client cache that a server-side tool call makes stale. */
export type ToolCacheEffect = "trigger-schedules" | "trigger-subscriptions"

/** Server-side platform ops (`op_catalog.py`) whose only browser signal is the settled tool part. */
const CACHE_EFFECT_BY_TOOL = new Map<string, ToolCacheEffect>([
    ["create_schedule", "trigger-schedules"],
    ["remove_schedule", "trigger-schedules"],
    ["pause_schedule", "trigger-schedules"],
    ["resume_schedule", "trigger-schedules"],
    ["create_subscription", "trigger-subscriptions"],
    ["remove_subscription", "trigger-subscriptions"],
    ["pause_subscription", "trigger-subscriptions"],
    ["resume_subscription", "trigger-subscriptions"],
])

/** Keys on the canonical name: Claude sends `mcp__agenta-tools__create_schedule`, Pi the bare name. */
export const toolCacheEffect = (toolName: string): ToolCacheEffect | null =>
    CACHE_EFFECT_BY_TOOL.get(canonicalClientToolName(toolName)) ?? null

export interface SettledToolCall {
    toolCallId: string
    name: string
    input: unknown
}

/** Successful calls in `message` not yet in `seen`; records them so each is returned once. */
export function takeSettledToolCalls(message: UIMessage, seen: Set<string>): SettledToolCall[] {
    const calls: SettledToolCall[] = []
    for (const part of message.parts) {
        if (!isToolPart(part.type)) continue
        const tool = part as {toolCallId?: string; state?: string; input?: unknown}
        if (tool.state !== "output-available") continue
        const toolCallId = tool.toolCallId ?? ""
        if (!toolCallId || seen.has(toolCallId)) continue
        seen.add(toolCallId)
        calls.push({toolCallId, name: partToolName(part as ToolUIPart), input: tool.input})
    }
    return calls
}
