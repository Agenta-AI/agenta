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
 * The model's max context window is not exposed by the backend today (the registry stores only
 * cost), so `MODEL_CONTEXT_WINDOWS` is the single hardcoded source for the "/ max (%)" denominator.
 */
import type {UIMessage} from "ai"

import {getMessageUsage} from "./trace"

/**
 * Model id (substring) → total context window in tokens. Keys are matched case-insensitively,
 * after stripping any `provider/` or `provider:` prefix, by exact then longest-substring match, so
 * dated snapshots (`claude-opus-4-20250101`) resolve to their base entry. Keep values conservative
 * and extend as models are added; a follow-up can source these from litellm `get_model_info()`.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // OpenAI
    "gpt-4o-mini": 128_000,
    "gpt-4o": 128_000,
    "gpt-4.1-mini": 1_047_576,
    "gpt-4.1-nano": 1_047_576,
    "gpt-4.1": 1_047_576,
    "gpt-4-turbo": 128_000,
    "o1-mini": 128_000,
    o1: 200_000,
    "o3-mini": 200_000,
    o3: 200_000,
    "o4-mini": 200_000,
    // Anthropic
    "claude-3-5-sonnet": 200_000,
    "claude-3-5-haiku": 200_000,
    "claude-3-7-sonnet": 200_000,
    "claude-opus-4": 200_000,
    "claude-sonnet-4": 200_000,
    "claude-haiku-4": 200_000,
    // Google Gemini
    "gemini-1.5-pro": 2_097_152,
    "gemini-1.5-flash": 1_048_576,
    "gemini-2.0-flash": 1_048_576,
    "gemini-2.5-pro": 1_048_576,
    "gemini-2.5-flash": 1_048_576,
}

/**
 * Resolve the max context window for a model id. Returns `null` when the model is unknown, in which
 * case the indicator shows the token count without a "/ max (%)" fraction.
 */
export function resolveModelContextWindow(model: string | null | undefined): number | null {
    if (!model) return null
    const id = model.toLowerCase()
    const bare = id.replace(/^[a-z0-9._-]+[/:]/, "")
    if (MODEL_CONTEXT_WINDOWS[bare]) return MODEL_CONTEXT_WINDOWS[bare]
    let best: {key: string; win: number} | null = null
    for (const [key, win] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
        if (bare.includes(key) && (!best || key.length > best.key.length)) {
            best = {key, win}
        }
    }
    return best?.win ?? null
}

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
