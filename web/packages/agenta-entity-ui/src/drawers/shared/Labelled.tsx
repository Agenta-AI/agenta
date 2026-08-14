import type {ReactNode} from "react"

/**
 * One labelled field in a drawer's flat field stack — the shape both trigger drawers use in
 * place of the old accordion sections. A label and its control, nothing else: status chips,
 * summaries and required markers were what made the sections heavy.
 */
export function Labelled({label, children}: {label: string; children: ReactNode}) {
    return (
        <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[var(--ag-colorTextDescription)]">
                {label}
            </span>
            {children}
        </div>
    )
}
