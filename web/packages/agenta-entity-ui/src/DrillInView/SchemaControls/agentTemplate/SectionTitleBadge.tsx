/**
 * SectionTitleBadge
 *
 * The short pill rendered next to a config section title for a blocking case the user must
 * resolve ("No model", "Unavailable", "Connect key"). Kept terse so it never crowds the title —
 * the section shell truncates the title and keeps the badge `shrink-0`.
 *
 * Presentational: tone in, pill out. The tone matches the section header's indicator tone.
 */
import {cn} from "@agenta/ui/styles"

export type SectionTitleBadgeTone = "warning" | "error"

export interface SectionTitleBadgeProps {
    label: string
    tone: SectionTitleBadgeTone
    className?: string
}

export const SectionTitleBadge = ({label, tone, className}: SectionTitleBadgeProps) => (
    <span
        className={cn(
            "whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium leading-none",
            tone === "error"
                ? "bg-[var(--ag-colorErrorBg)] text-[var(--ag-colorError)]"
                : "bg-[var(--ag-colorWarningBg)] text-[var(--ag-colorWarning)]",
            className,
        )}
    >
        {label}
    </span>
)
