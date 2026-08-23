import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"

import IntegrationBadges from "./IntegrationBadges"

/**
 * One template as a LIST row, for the rail.
 *
 * The card is 238px of fixed width with the badges on their own line — in a 340px column two of
 * them barely fit side by side and the third is always half cut. A row spends the width it has on
 * the name and what the template does, and stacks vertically instead of scrolling sideways.
 */
const StripRow = ({
    template,
    selected,
    onPick,
}: {
    template: AgentStarterTemplate
    selected: boolean
    onPick: (template: AgentStarterTemplate) => void
}) => (
    <button
        type="button"
        aria-pressed={selected}
        onClick={() => onPick(template)}
        className={`group box-border flex w-full cursor-pointer items-start gap-3 rounded-lg border-0 px-2 py-2.5 text-left ${
            selected
                ? "bg-[var(--ag-strip-selected-bg)]"
                : "bg-transparent hover:bg-colorFillQuaternary"
        }`}
    >
        <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white"
            style={{background: template.color}}
        >
            {template.initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-colorText">
                    {template.name}
                </span>
                {/* Badges ride the title line: on their own row they pushed every row to three
                    lines for a detail nobody scans a rail for. */}
                <IntegrationBadges slugs={templateProviderSlugs(template)} />
            </span>
            <span className="line-clamp-2 text-[13px] leading-snug text-colorTextSecondary">
                {template.description}
            </span>
        </span>
    </button>
)

export default StripRow
