import type {ReactNode} from "react"

import {DiffersBadge} from "./DiffersBadge"

/** One section of the Configuration tab: a titled card the section nav scrolls to. */
export const ConfigSection = ({
    id,
    title,
    subtitle,
    differs = false,
    children,
}: {
    id: string
    title: string
    subtitle?: string | null
    /** Compare mode: something the section lists differs and has no row to mark. */
    differs?: boolean
    children: ReactNode
}) => (
    <section
        id={id}
        aria-labelledby={`${id}-title`}
        className="box-border flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-lg border border-solid border-border bg-card p-4"
    >
        <header className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
                <h2 id={`${id}-title`} className="m-0 text-base font-semibold text-foreground">
                    {title}
                </h2>
                {differs ? <DiffersBadge /> : null}
            </div>
            {subtitle ? (
                <p className="m-0 truncate text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
        </header>
        {children}
    </section>
)
