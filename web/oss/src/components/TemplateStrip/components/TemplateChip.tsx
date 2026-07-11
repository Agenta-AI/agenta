import {X} from "lucide-react"

import {
    templateProviderSlugs,
    type AgentTemplate,
} from "@/oss/components/pages/agent-home/assets/templates"

import {STRIP_COPY} from "../assets/constants"

import IntegrationBadges from "./IntegrationBadges"

/**
 * Provenance chip docked above the composer ("From template: <name>"). No bottom border —
 * it must sit flush against the composer's top edge (adjacent siblings, no gap).
 */
const TemplateChip = ({
    template,
    onClear,
    className,
    style,
}: {
    template: AgentTemplate
    onClear: () => void
    className?: string
    style?: React.CSSProperties
}) => (
    <div
        style={style}
        // box-border so an explicit width (set by TemplateChipDock) measures border-box, matching
        // the ghost's offsetWidth exactly. Border matches the selected composer's accent so the
        // chip + composer read as one connected shape (the composer forces --ag-colorPrimary too).
        className={`box-border inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-t-[9px] border-[1.5px] border-b-0 border-solid border-[var(--ag-colorPrimary)] bg-[var(--ag-strip-selected-bg)] px-3 py-1.5 text-[12.5px] text-[var(--ag-colorTextSecondary)] ${className ?? ""}`}
    >
        <span
            className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[9px] font-semibold text-white"
            style={{background: template.color}}
        >
            {template.initials}
        </span>
        <span>
            {STRIP_COPY.fromTemplate}{" "}
            <b className="font-semibold text-[var(--ag-colorText)]">{template.name}</b>
        </span>
        <IntegrationBadges slugs={templateProviderSlugs(template)} size="chip" />
        <button
            type="button"
            aria-label="Remove template"
            onClick={onClear}
            className="cursor-pointer border-0 bg-transparent px-0.5 py-0 text-[var(--ag-colorTextTertiary)] hover:text-[var(--ag-colorTextSecondary)]"
        >
            <X size={12} />
        </button>
    </div>
)

export default TemplateChip
