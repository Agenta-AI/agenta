import {templateProviderSlugs, type AgentTemplate} from "../../assets/templates"

import ProviderMarks from "./ProviderMarks"

interface TemplateCardProps {
    template: AgentTemplate
    onSelect: (template: AgentTemplate) => void
}

/** Info-rich starter-template tile: monogram + name, description, tools·trigger meta + provider logos. */
const TemplateCard = ({template, onSelect}: TemplateCardProps) => {
    return (
        <button
            type="button"
            onClick={() => onSelect(template)}
            className="group flex h-full min-h-[132px] cursor-pointer flex-col gap-3 rounded-lg border border-solid border-transparent bg-[var(--ag-colorFillQuaternary)] p-4 text-left transition-colors hover:border-[var(--ag-colorBorderSecondary)] hover:bg-[var(--ag-colorFillTertiary)]"
        >
            <div className="flex items-center gap-3">
                <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
                    style={{backgroundColor: template.color}}
                >
                    {template.initials}
                </span>
                <span className="truncate text-sm font-medium">{template.name}</span>
            </div>

            <p className="m-0 line-clamp-2 text-[13px] leading-snug text-[var(--ag-colorTextSecondary)]">
                {template.description}
            </p>

            <div className="mt-auto flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                    {template.toolsSummary} · {template.trigger}
                </span>
                <ProviderMarks providers={templateProviderSlugs(template)} />
            </div>
        </button>
    )
}

export default TemplateCard
