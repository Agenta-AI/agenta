/**
 * ContextBudgetIndicator — the ambient "Context 39% used" meter above the composer.
 *
 * A slim fill bar + one plain-language line. Quiet (neutral) while there's room, escalating to
 * amber then red with alarm wording as the window fills, so non-technical users get a signal
 * without reading token math. Exact token counts live in the tooltip for power users.
 *
 * Renders nothing until a turn has reported usage. When the model's context window is unknown it
 * falls back to a quiet raw token count with no bar or percent.
 */
import {useMemo} from "react"

import {Warning} from "@phosphor-icons/react"
import type {UIMessage} from "ai"
import {Tooltip} from "antd"

import {computeContextBudget} from "../assets/contextBudget"

export interface ContextBudgetIndicatorProps {
    messages: readonly UIMessage[]
    /** Max context window for the selected model, from the harness catalog; `null` when unknown. */
    maxTokens: number | null
    className?: string
}

/** Compact token formatting, no noisy trailing ".0": 34_200 → "34.2k", 407_027 → "407k", 1_048_576 → "1M". */
const compact = (n: number, div: number, suffix: string): string => {
    const s = (n / div).toFixed(1)
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}${suffix}`
}
const fmt = (n: number): string => {
    if (n >= 1_000_000) return compact(n, 1_000_000, "M")
    if (n >= 1_000) return compact(n, 1_000, "k")
    return `${n}`
}

type Tier = "normal" | "warn" | "danger"

const tierFor = (pct: number | null): Tier =>
    pct == null ? "normal" : pct >= 0.9 ? "danger" : pct >= 0.75 ? "warn" : "normal"

const FILL: Record<Tier, string> = {
    normal: "bg-colorTextTertiary",
    warn: "bg-colorWarning",
    danger: "bg-colorError",
}

const TEXT: Record<Tier, string> = {
    normal: "text-colorTextTertiary",
    warn: "text-colorWarning",
    danger: "text-colorError",
}

const ContextBudgetIndicator = ({messages, maxTokens, className}: ContextBudgetIndicatorProps) => {
    const budget = useMemo(() => computeContextBudget(messages, maxTokens), [messages, maxTokens])

    const {occupancyTokens: occ, maxTokens: max, occupancyPct: pct} = budget
    if (occ == null) return null

    const tier = tierFor(pct)
    const pctInt = pct != null ? Math.round(pct * 100) : null
    const label =
        pctInt != null
            ? tier === "danger"
                ? `Context almost full · ${pctInt}%`
                : `Context ${pctInt}% used`
            : `Context ${fmt(occ)} tokens`

    return (
        <Tooltip
            title={
                <div className="flex flex-col gap-1 text-xs">
                    <span>
                        Context window:
                        <br />
                        As it fills up, earlier messages are compressed into summaries, which may
                        reduce recall of older details.
                    </span>
                    <span className="opacity-70">
                        {max
                            ? `${fmt(occ)} / ${fmt(max)} tokens`
                            : `${fmt(occ)} tokens · model window unknown`}
                    </span>
                </div>
            }
            placement="topRight"
            mouseEnterDelay={0.4}
        >
            <span
                className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className ?? ""}`}
            >
                {pctInt != null ? (
                    <span
                        className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-colorFillQuaternary"
                        aria-hidden
                    >
                        <span
                            className={`block h-full rounded-full ${FILL[tier]}`}
                            style={{width: `${pctInt}%`}}
                        />
                    </span>
                ) : null}
                <span className={`inline-flex items-center gap-1 text-xs ${TEXT[tier]}`}>
                    {tier === "danger" ? (
                        <Warning size={12} weight="fill" className="shrink-0" />
                    ) : null}
                    {label}
                </span>
            </span>
        </Tooltip>
    )
}

export default ContextBudgetIndicator
