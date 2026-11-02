/**
 * The "Needs setup" tag with the reason on a second line. Rows built on `ItemRow` get the same
 * pair through their status; this is for the places that are not item rows (the model section,
 * a secret attachment, the MCP connection field).
 */
import {NEEDS_SETUP_LABEL} from "@agenta/entities/workflow"
import {Tag} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"

export interface NeedsSetupTagProps {
    /** The reason line, from `needsSetupReasonLabel`. */
    reason?: string | null
    /** False shows the reason alone, where a section title already carries the tag. */
    tag?: boolean
    className?: string
}

export function NeedsSetupTag({reason, tag = true, className}: NeedsSetupTagProps) {
    return (
        <span className={cn("flex min-w-0 flex-col items-start gap-0.5", className)}>
            {tag ? (
                <Tag tone="gold" className="m-0 text-xs leading-[22.4px]">
                    {NEEDS_SETUP_LABEL}
                </Tag>
            ) : null}
            {reason ? (
                <span className="truncate text-xs leading-tight text-[var(--ag-colorWarningText)]">
                    {reason}
                </span>
            ) : null}
        </span>
    )
}
