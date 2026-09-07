import {Warning} from "@phosphor-icons/react"

/**
 * The last run failed — said once, at the top, with the reason.
 *
 * Nothing renders without a reason: an automation that has never failed must not carry a
 * reserved slot for failure.
 */
export const AutomationFailureBanner = ({reason}: {reason?: string | null}) => {
    if (!reason) return null

    return (
        <div
            role="status"
            className="border-destructive/40 bg-destructive/10 flex items-start gap-2 rounded-lg border p-3"
        >
            <Warning
                aria-hidden
                weight="fill"
                size={16}
                className="text-destructive mt-px shrink-0"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-destructive text-sm font-medium">
                    The last run didn&apos;t finish
                </span>
                <span className="text-muted-foreground text-xs leading-snug">{reason}</span>
            </div>
        </div>
    )
}
