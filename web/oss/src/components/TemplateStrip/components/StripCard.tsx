import {
    templateProviderSlugs,
    type AgentTemplate,
} from "@/oss/components/pages/agent-home/assets/templates"

import IntegrationBadges from "./IntegrationBadges"

/**
 * One template card. Fixed 238px in the scroll strip; `fluid` fills its grid cell on the
 * home 3-up layout. A real button (keyboard focusable); the border is a constant 1.5px so
 * the box never shifts between default/hover/selected states.
 */
const StripCard = ({
    template,
    selected,
    onPick,
    fluid = false,
}: {
    template: AgentTemplate
    selected: boolean
    onPick: (template: AgentTemplate) => void
    fluid?: boolean
}) => (
    <button
        type="button"
        aria-pressed={selected}
        onClick={() => onPick(template)}
        className={`${fluid ? "w-full" : "w-[238px] flex-none snap-start"} cursor-pointer rounded-[10px] border-[1.5px] border-solid p-[15px] text-left transition-[border-color,box-shadow] duration-150 ${
            selected
                ? "border-[var(--ag-colorPrimary)] bg-[var(--ag-strip-selected-bg)]"
                : "border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)] hover:border-[var(--ag-colorBorder)] hover:shadow-[var(--ag-strip-card-hover-shadow)]"
        }`}
    >
        <div className="mb-[11px] flex items-start justify-between">
            <span
                className="flex size-8 items-center justify-center rounded-lg text-[13px] font-semibold text-white"
                style={{background: template.color}}
            >
                {template.initials}
            </span>
            <IntegrationBadges slugs={templateProviderSlugs(template)} />
        </div>
        <div className="mb-1 text-[14.5px] font-semibold text-[var(--ag-colorText)]">
            {template.name}
        </div>
        <div className="text-[12.5px] leading-[1.45] text-[var(--ag-colorTextSecondary)]">
            {template.description}
        </div>
    </button>
)

export default StripCard
