/**
 * ContextBudgetIndicator — the compact "Context 31.3k / 200k (16%)" strip above the composer.
 *
 * v1 shows BOTH candidate measures side by side so we can compare them on a live agent and pick
 * the right one (then drop the other + its label):
 *   - **Ctx** = occupancy (latest turn's tokens = how full the window is now; predicts compaction)
 *   - **Σ**   = running sum (cumulative tokens across the session)
 *
 * Renders nothing until at least one turn has reported usage. When the model's context window is
 * unknown it shows the token counts without the "/ max (%)" fraction.
 */
import {useMemo} from "react"

import type {UIMessage} from "ai"
import {Tooltip, Typography} from "antd"

import {computeContextBudget} from "../assets/contextBudget"

const {Text} = Typography

export interface ContextBudgetIndicatorProps {
    messages: readonly UIMessage[]
    /** Max context window for the selected model, from the harness catalog; `null` when unknown. */
    maxTokens: number | null
    className?: string
}

/** Compact token formatting: 31_300 → "31.3k", 1_047_576 → "1.0M". */
const fmt = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return `${n}`
}

const pctLabel = (pct: number | null): string => (pct == null ? "" : ` (${Math.round(pct * 100)}%)`)

const ContextBudgetIndicator = ({messages, maxTokens, className}: ContextBudgetIndicatorProps) => {
    const budget = useMemo(() => computeContextBudget(messages, maxTokens), [messages, maxTokens])

    if (budget.occupancyTokens == null && budget.runningSumTokens == null) return null

    const maxSuffix = budget.maxTokens ? ` / ${fmt(budget.maxTokens)}` : ""

    return (
        <Tooltip
            title={
                <div className="flex flex-col gap-1 text-xs">
                    <span>
                        <b>Ctx</b> — tokens in the context window right now (latest turn). Predicts
                        when the conversation compacts, and drops after it does.
                    </span>
                    <span>
                        <b>Σ</b> — total tokens across the whole session (cumulative usage).
                    </span>
                    <span className="opacity-70">
                        {budget.maxTokens
                            ? `Model window ≈ ${fmt(budget.maxTokens)} tokens`
                            : "Model context window unknown"}
                    </span>
                </div>
            }
            placement="topRight"
            mouseEnterDelay={0.4}
        >
            <Text type="secondary" className={`text-xs whitespace-nowrap ${className ?? ""}`}>
                {budget.occupancyTokens != null ? (
                    <span>
                        Ctx {fmt(budget.occupancyTokens)}
                        {maxSuffix}
                        {pctLabel(budget.occupancyPct)}
                    </span>
                ) : null}
                {budget.runningSumTokens != null ? (
                    <span className="ml-2 opacity-80">
                        · Σ {fmt(budget.runningSumTokens)}
                        {pctLabel(budget.runningSumPct)}
                    </span>
                ) : null}
            </Text>
        </Tooltip>
    )
}

export default ContextBudgetIndicator
