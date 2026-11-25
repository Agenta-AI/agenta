/** One plan row: a label and a value, with a bar when the value is a count against a limit. */
export const LicenseUsageRow = ({
    label,
    value,
    count,
    limit,
}: {
    label: string
    value: string
    count?: number
    /** `null` or unset: unlimited, so no bar. */
    limit?: number | null
}) => {
    const bar = count !== undefined && typeof limit === "number" && limit > 0
    const percent = bar ? Math.min(100, Math.round((count / limit) * 100)) : 0
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-muted-foreground">{label}</span>
                <span className="text-foreground truncate text-right tabular-nums">{value}</span>
            </div>
            {bar ? (
                <div
                    role="progressbar"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={limit}
                    aria-valuenow={count}
                    className="bg-muted h-1.5 overflow-hidden rounded-full"
                >
                    <div
                        className="bg-colorInfo h-full rounded-full"
                        style={{width: `${percent}%`}}
                    />
                </div>
            ) : null}
        </div>
    )
}
