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
            className="mt-4 flex items-start gap-2.5 rounded-[10px] border border-solid border-destructive/40 bg-destructive/10 px-3.5 py-3"
        >
            <Warning
                aria-hidden
                weight="fill"
                size={16}
                className="mt-px shrink-0 text-destructive"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] font-medium text-destructive">
                    The last run didn&apos;t finish
                </span>
                <span className="text-[13px] leading-snug text-muted-foreground">{reason}</span>
            </div>
        </div>
    )
}
