/**
 * Context token budget — the data behind the "Context 31.3k / 200k (16%)" indicator.
 *
 * This slice runs each turn through `useChat`; the runner stamps real token usage onto every
 * assistant message (`metadata.usage = {input, output, total, cost}` → read via `getMessageUsage`).
 * From those per-turn totals we compute TWO candidate measures so the UI can show them side by
 * side until we pick one:
 *
 *   - **occupancy**  = the LATEST assistant turn's total tokens. Because the whole conversation is
 *     resent every turn, this already grows with the chat AND equals how full the context window is
 *     right now — so it predicts compaction and correctly DROPS after a compaction/summarization.
 *   - **runningSum** = Σ of every assistant turn's total tokens. A cumulative usage meter; it
 *     double-counts the resent history (turn 2's prompt re-includes turn 1) so it climbs far faster
 *     than real occupancy and never drops. Included only for the comparison.
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
    /** Σ of every assistant turn's total tokens this session. `null` until a turn has usage. */
    runningSumTokens: number | null
    /** Per-turn totals, oldest → newest (for the tooltip / debugging). */
    perTurnTokens: number[]
    /** Model context window, or `null` when unknown. */
    maxTokens: number | null
    /** occupancy / max, clamped 0..1; `null` when max unknown or no usage yet. */
    occupancyPct: number | null
    /** runningSum / max, clamped 0..1; `null` when max unknown or no usage yet. */
    runningSumPct: number | null
}

const pctOf = (n: number | null, max: number | null): number | null =>
    n != null && max ? Math.min(n / max, 1) : null

/**
 * Compute both budget measures from a session's messages and its model's context window.
 * Reads real per-turn usage off assistant messages (`getMessageUsage`), preferring `totalTokens`
 * and falling back to `promptTokens` when only the input side was stamped.
 */
export function computeContextBudget(
    messages: readonly UIMessage[],
    maxTokens: number | null,
): ContextBudget {
    const perTurnTokens: number[] = []
    for (const message of messages) {
        if (message.role !== "assistant") continue
        const usage = getMessageUsage(message)
        const total = usage?.totalTokens ?? usage?.promptTokens
        if (typeof total === "number") perTurnTokens.push(total)
    }

    const hasUsage = perTurnTokens.length > 0
    const occupancyTokens = hasUsage ? perTurnTokens[perTurnTokens.length - 1] : null
    const runningSumTokens = hasUsage ? perTurnTokens.reduce((a, b) => a + b, 0) : null

    return {
        occupancyTokens,
        runningSumTokens,
        perTurnTokens,
        maxTokens,
        occupancyPct: pctOf(occupancyTokens, maxTokens),
        runningSumPct: pctOf(runningSumTokens, maxTokens),
    }
}
