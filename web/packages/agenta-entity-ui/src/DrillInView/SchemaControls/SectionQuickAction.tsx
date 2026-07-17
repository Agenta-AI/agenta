/**
 * SectionQuickAction
 *
 * The inline body a config section shows when required info is missing — a "resolve it right here"
 * affordance instead of the plain row that only opens a drawer. It pairs the minimal control that
 * fixes the gap (the SAME input the section's drawer uses, passed as `children`) with a link to the
 * full drawer for everything else. First use: the Model & harness section's "Connect key" state
 * (the provider API-key field). Kept generic so other sections can adopt the same pattern.
 */
import type {ReactNode} from "react"

import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button} from "antd"

export interface SectionQuickActionProps {
    /** The minimal control that resolves the missing info (e.g. the provider API-key field). */
    children: ReactNode
    /** Opens the section's full configuration drawer. */
    onOpenDetails: () => void
    /** Link label; defaults to "Detailed configuration". */
    detailsLabel?: string
    disabled?: boolean
}

export function SectionQuickAction({
    children,
    onOpenDetails,
    detailsLabel = "Detailed configuration",
    disabled,
}: SectionQuickActionProps) {
    return (
        <div className="flex flex-col gap-3">
            {children}
            <Button
                type="text"
                onClick={onOpenDetails}
                disabled={disabled}
                className="!h-auto w-fit !px-0 !text-xs !text-[var(--ag-colorPrimary)]"
                icon={<ArrowSquareOut size={13} />}
            >
                {detailsLabel}
            </Button>
        </div>
    )
}
