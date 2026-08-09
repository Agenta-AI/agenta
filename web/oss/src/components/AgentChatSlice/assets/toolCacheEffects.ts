/**
 * Which client cache a settled tool call invalidates. Platform ops run server-side, so a tool that
 * mutates project data leaves the browser's cache stale until a reload (#5781) — the settled part
 * is the only signal available. The durable fix is a backend `data-*` signal like
 * `data-committed-revision`; until the runner can emit one, this registry stands in.
 */
import type {ToolUIPart, UIMessage} from "ai"

import {isToolPart} from "./messageParts"
import {partToolName} from "./toolDisplay"

export type ToolCacheEffect = "trigger-schedules" | "trigger-subscriptions"

/** Mutating trigger ops by wire name (`op_catalog.py`). `list_*`, `discover_triggers` and
 * `test_subscription` leave both lists unchanged, so they are absent. A Map, not an object —
 * tool names are third-party strings, and `{}[toolName]` would resolve `toString` et al. */
const BY_TOOL_NAME = new Map<string, ToolCacheEffect>([
    ["create_schedule", "trigger-schedules"],
    ["remove_schedule", "trigger-schedules"],
    ["pause_schedule", "trigger-schedules"],
    ["resume_schedule", "trigger-schedules"],
    ["create_subscription", "trigger-subscriptions"],
    ["remove_subscription", "trigger-subscriptions"],
    ["pause_subscription", "trigger-subscriptions"],
    ["resume_subscription", "trigger-subscriptions"],
])

/** The cache a tool invalidates, or null when it touches nothing the client caches. */
export const toolCacheEffect = (toolName: string): ToolCacheEffect | null =>
    BY_TOOL_NAME.get(toolName) ?? null

/** Effects owed by `message`'s successful tool calls, skipping ids in `seen` — which this RECORDS
 * every visited call into, so each acts once. */
export function collectToolCacheEffects(
    message: UIMessage,
    seen: Set<string>,
): Set<ToolCacheEffect> {
    const effects = new Set<ToolCacheEffect>()
    for (const part of message.parts) {
        if (!isToolPart(part)) continue
        const tool = part as {toolCallId?: string; state?: string}
        // Successful only — a failed create must not invalidate.
        if (tool.state !== "output-available") continue
        const toolCallId = tool.toolCallId ?? ""
        if (!toolCallId || seen.has(toolCallId)) continue
        seen.add(toolCallId)
        const effect = toolCacheEffect(partToolName(part as ToolUIPart))
        if (effect) effects.add(effect)
    }
    return effects
}
