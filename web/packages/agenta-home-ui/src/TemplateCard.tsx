import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"

import {TemplateProviderMarks} from "./TemplateProviderMarks"

export interface TemplateCardProps {
    template: AgentStarterTemplate
    onSelect: (template: AgentStarterTemplate) => void
}

/**
 * A template, in the same card shape an agent uses.
 *
 * A template IS an agent you haven't made yet, so the two read as one object type: monogram
 * straddling the top edge, name, description, then a footer of the connections it needs. The
 * design's "1.2k uses" has no telemetry behind it — the footer carries what the template actually
 * declares (its tools and when it fires) instead of an invented popularity number.
 */
export const TemplateCard = ({template, onSelect}: TemplateCardProps) => {
    return (
        <button
            type="button"
            onClick={() => onSelect(template)}
            className="group relative box-border flex h-full cursor-pointer flex-col gap-2.5 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-5 pt-8 text-left transition-colors hover:border-colorBorder"
        >
            <span
                aria-hidden
                className="absolute -top-5 left-4 flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-solid border-colorBgContainer text-sm font-semibold text-white"
                style={{backgroundColor: template.color}}
            >
                {template.initials}
            </span>

            <span className="truncate text-[15px] font-semibold text-colorText">
                {template.name}
            </span>

            <p className="m-0 line-clamp-2 text-[13px] leading-snug text-colorTextSecondary">
                {template.description}
            </p>

            <div className="mt-auto flex items-center gap-2 pt-3">
                <TemplateProviderMarks providers={templateProviderSlugs(template)} />
                <span className="ml-auto truncate text-xs text-colorTextTertiary">
                    {template.toolsSummary} · {template.trigger}
                </span>
            </div>
        </button>
    )
}
