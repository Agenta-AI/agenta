import type {ReactNode} from "react"

/** One section of the Configuration tab: a titled card the section nav scrolls to. */
export const ConfigSection = ({
    id,
    title,
    subtitle,
    children,
}: {
    id: string
    title: string
    subtitle?: string | null
    children: ReactNode
}) => (
    <section
        id={id}
        aria-labelledby={`${id}-title`}
        className="box-border flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-lg border border-solid border-border bg-card p-4"
    >
        <header className="flex min-w-0 flex-col gap-0.5">
            <h2 id={`${id}-title`} className="m-0 text-base font-semibold text-foreground">
                {title}
            </h2>
            {subtitle ? (
                <p className="m-0 truncate text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
        </header>
        {children}
    </section>
)
