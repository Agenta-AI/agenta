import {templateProviderSlugs, type AgentTemplate} from "../../assets/templates"

import ProviderMarks from "./ProviderMarks"

interface TemplateCardProps {
    template: AgentTemplate
    onSelect: (template: AgentTemplate) => void
}

/** Starter-template tile: monogram + provider chips row, then name and description. */
const TemplateCard = ({template, onSelect}: TemplateCardProps) => {
    return (
        <button
            type="button"
            onClick={() => onSelect(template)}
            className="group flex h-full min-h-[132px] cursor-pointer flex-col rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)] p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-[var(--ag-colorBorder)] hover:shadow-[0_2px_8px_-2px_rgba(28,44,61,0.12)]"
        >
            <div className="mb-3 flex items-start justify-between gap-2">
                <span
                    className="flex size-[34px] shrink-0 items-center justify-center rounded-[8px] text-sm font-semibold text-white"
                    style={{backgroundColor: template.color}}
                >
                    {template.initials}
                </span>
                <ProviderMarks providers={templateProviderSlugs(template)} />
            </div>

            <span className="mb-[5px] truncate text-[15px] font-semibold">{template.name}</span>

            <p className="m-0 line-clamp-2 text-[13px] leading-[1.45] text-[var(--ag-colorTextSecondary)]">
                {template.description}
            </p>
        </button>
    )
}

export default TemplateCard
