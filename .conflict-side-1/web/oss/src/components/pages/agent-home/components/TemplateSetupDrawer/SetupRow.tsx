import type {ReactNode} from "react"

interface SetupRowProps {
    /** Fully-styled leading icon/logo node. */
    icon: ReactNode
    title: ReactNode
    subtitle?: ReactNode
    /** Right-aligned status/action slot. */
    right?: ReactNode
}

/** Icon + title + subtitle + right-slot row, shared by the setup drawer's read + required rows. */
const SetupRow = ({icon, title, subtitle, right}: SetupRowProps) => {
    return (
        <div className="flex items-center gap-3">
            <span className="flex shrink-0 items-center justify-center">{icon}</span>
            <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[var(--ag-colorText)]">{title}</div>
                {subtitle ? (
                    <div className="text-[11px] leading-snug text-[var(--ag-colorTextSecondary)]">
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {right ? <div className="shrink-0">{right}</div> : null}
        </div>
    )
}

export default SetupRow
