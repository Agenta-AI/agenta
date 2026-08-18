import {CircleNotchIcon} from "@phosphor-icons/react"

import {templateProviderSlugs, type AgentTemplate} from "../../assets/templates"

import ProviderMarks from "./ProviderMarks"

interface TemplateCardProps {
    template: AgentTemplate
    onSelect: (template: AgentTemplate) => void
    /** This card's agent is being created — swaps the monogram for a spinner and blocks re-clicks. */
    loading?: boolean
    /** Another card's create is in flight. */
    disabled?: boolean
}

/**
 * A template, in the same card shape an agent uses.
 *
 * A template IS an agent you haven't made yet, so the two read as one object type: monogram
 * straddling the top edge, name, description, then a footer of the connections it needs. The
 * design's "1.2k uses" has no telemetry behind it — the footer carries what the template actually
 * declares (its tools and when it fires) instead of an invented popularity number.
 */
const TemplateCard = ({template, onSelect, loading, disabled}: TemplateCardProps) => {
    const busy = loading || disabled
    return (
        <button
            type="button"
            disabled={busy}
            aria-busy={loading}
            onClick={() => onSelect(template)}
            // Warm tinted card in light, matching the home strip's template cards; dark restores
            // the elevated surface it renders today.
            className={`group relative box-border flex h-full flex-col gap-2.5 rounded-xl border border-solid border-colorBorderSecondary bg-[var(--ag-surface-paper)] p-5 pt-8 text-left transition-colors dark:bg-colorBgElevated ${
                busy ? "cursor-default" : "cursor-pointer hover:border-colorBorder"
            } ${disabled ? "opacity-60" : ""}`}
        >
            <span
                aria-hidden
                className="absolute -top-5 left-4 flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-solid border-colorBgContainer text-sm font-semibold text-white"
                style={{backgroundColor: template.color}}
            >
                {loading ? (
                    <CircleNotchIcon size={16} className="animate-spin" />
                ) : (
                    template.initials
                )}
            </span>

            <span className="truncate text-base font-semibold text-colorText">{template.name}</span>

            <p className="m-0 line-clamp-2 text-[13px] leading-snug text-colorTextSecondary">
                {template.description}
            </p>

            <div className="mt-auto flex items-center gap-2 pt-3">
                <ProviderMarks providers={templateProviderSlugs(template)} />
                <span className="ml-auto truncate text-xs text-colorTextTertiary">
                    {template.toolsSummary} · {template.trigger}
                </span>
            </div>
        </button>
    )
}

export default TemplateCard
