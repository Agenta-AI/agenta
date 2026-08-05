/**
 * Context token budget — the data behind the ambient "Context 39% used" meter above the composer.
 *
 * This slice runs each turn through `useChat`; the runner stamps real token usage onto every
 * assistant message (`metadata.usage = {input, output, total, cost}` → read via `getMessageUsage`).
 * Occupancy = the LATEST assistant turn's total tokens: because the whole conversation is resent
 * every turn, this equals how full the context window is right now, so it predicts compaction and
 * correctly DROPS after a compaction/summarization.
 *
 * The max context window (`maxTokens`) comes from the harness model catalog — the SDK's own
 * `context_window` per model, delivered to the frontend on the harness-capabilities document and
 * resolved via `contextWindowForModel` (@agenta/entities/workflow). Nothing is hardcoded here.
 */
import type {UIMessage} from "ai"

import {getMessageUsage} from "./trace"

export interface ContextBudget {
    /** Latest assistant turn's total tokens — current window occupancy. `null` until a turn has usage. */
    occupancyTokens: number | null
    /** Model context window, or `null` when unknown. */
    maxTokens: number | null
    /** occupancy / max, clamped 0..1; `null` when max unknown or no usage yet. */
    occupancyPct: number | null
}

/**
 * Compute window occupancy from a session's messages and its model's context window.
 * Reads real per-turn usage off assistant messages (`getMessageUsage`), preferring `totalTokens`
 * and falling back to `promptTokens` when only the input side was stamped.
 */
export function computeContextBudget(
    messages: readonly UIMessage[],
    maxTokens: number | null,
): ContextBudget {
    let occupancyTokens: number | null = null
    for (const message of messages) {
        if (message.role !== "assistant") continue
        const usage = getMessageUsage(message)
        const total = usage?.totalTokens ?? usage?.promptTokens
        if (typeof total === "number") occupancyTokens = total
    }

    return {
        occupancyTokens,
        maxTokens,
        occupancyPct:
            occupancyTokens != null && maxTokens ? Math.min(occupancyTokens / maxTokens, 1) : null,
    }
}
