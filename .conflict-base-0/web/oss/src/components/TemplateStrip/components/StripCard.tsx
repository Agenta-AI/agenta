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
        className={`${fluid ? "w-full" : "w-[238px] flex-none snap-start"} cursor-pointer rounded-xl border-[1.5px] border-solid ${fluid ? "p-5" : "p-[15px]"} text-left transition-[border-color,box-shadow] duration-150 ${
            selected
                ? "border-[var(--ag-colorPrimary)] bg-[var(--ag-strip-selected-bg)]"
                : "border-[var(--ag-strip-card-border)] bg-[var(--ag-strip-card-bg)] hover:border-[var(--ag-strip-card-border-hover)] hover:shadow-[var(--ag-strip-card-hover-shadow)]"
        }`}
    >
        <div className={`${fluid ? "mb-4" : "mb-[11px]"} flex items-start justify-between`}>
            <span
                className={`flex items-center justify-center font-semibold text-white ${
                    fluid ? "size-10 rounded-[10px] text-[14px]" : "size-8 rounded-lg text-[13px]"
                }`}
                style={{background: template.color}}
            >
                {template.initials}
            </span>
            <IntegrationBadges slugs={templateProviderSlugs(template)} />
        </div>
        <div
            className={`${fluid ? "mb-1.5 text-[15px]" : "mb-1 text-[14.5px]"} font-semibold text-[var(--ag-colorText)]`}
        >
            {template.name}
        </div>
        <div className="text-[12.5px] leading-[1.5] text-[var(--ag-colorTextSecondary)]">
            {template.description}
        </div>
    </button>
)

export default StripCard
