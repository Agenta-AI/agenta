import {Robot} from "@phosphor-icons/react"

/** First-run / no-results state for the "Your agents" table. */
const EmptyAgents = () => {
    return (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--ag-colorBorder)] p-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg bg-[var(--ag-colorFillTertiary)] text-[var(--ag-colorTextSecondary)]">
                <Robot size={20} />
            </span>
            <span className="text-xs font-medium">No agents yet</span>
            <span className="max-w-[360px] text-[11px] leading-snug text-[var(--ag-colorTextSecondary)]">
                Describe what you want above, or pick a template. Your agents will appear here once
                you create one.
            </span>
        </div>
    )
}

export default EmptyAgents
