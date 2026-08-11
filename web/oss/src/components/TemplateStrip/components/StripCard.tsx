import {CircleNotchIcon} from "@phosphor-icons/react"

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
    loading = false,
    disabled = false,
}: {
    template: AgentTemplate
    selected: boolean
    onPick: (template: AgentTemplate) => void
    fluid?: boolean
    /** This card's agent is being created — spins its monogram and blocks re-clicks. */
    loading?: boolean
    /** Another card's create is in flight. */
    disabled?: boolean
}) => (
    <button
        type="button"
        aria-pressed={selected}
        aria-busy={loading}
        disabled={loading || disabled}
        onClick={() => onPick(template)}
        className={`${fluid ? "w-full" : "w-[238px] flex-none snap-start"} rounded-xl border-[1.5px] border-solid ${fluid ? "p-5" : "p-[15px]"} text-left transition-[border-color,box-shadow] duration-150 ${
            loading || disabled ? "cursor-default" : "cursor-pointer"
        } ${disabled ? "opacity-60" : ""} ${
            selected
                ? "border-[var(--ag-colorPrimary)] bg-[var(--ag-strip-selected-bg)]"
                : // The warm tinted surface the Home and overview rails carry, so a template card
                  // reads as an object on the page rather than a white cutout. Light only: dark
                  // restores this strip's own card token (rgba(255,255,255,.04)), since the tint's
                  // dark step is a different surface and dark cards aren't part of this change.
                  `border-[var(--ag-strip-card-border)] bg-[var(--ag-surface-paper)] dark:bg-[var(--ag-strip-card-bg)] ${
                      loading || disabled
                          ? ""
                          : "hover:border-[var(--ag-strip-card-border-hover)] hover:shadow-[var(--ag-strip-card-hover-shadow)]"
                  }`
        }`}
    >
        <div className={`${fluid ? "mb-4" : "mb-[11px]"} flex items-start justify-between`}>
            <span
                className={`flex items-center justify-center font-semibold text-white ${
                    fluid ? "size-10 rounded-[10px] text-[14px]" : "size-8 rounded-lg text-[13px]"
                }`}
                style={{background: template.color}}
            >
                {loading ? (
                    <CircleNotchIcon size={fluid ? 18 : 15} className="animate-spin" />
                ) : (
                    template.initials
                )}
            </span>
            <IntegrationBadges slugs={templateProviderSlugs(template)} />
        </div>
        <div
            className={`${fluid ? "mb-1.5 text-base" : "mb-1 text-base"} font-semibold text-[var(--ag-colorText)]`}
        >
            {template.name}
        </div>
        <div className="text-xs leading-[1.5] text-[var(--ag-colorTextSecondary)]">
            {template.description}
        </div>
    </button>
)

export default StripCard
