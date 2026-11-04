import type {ReactNode} from "react"

/** One section of the live evaluation form: a title, a one line summary, then the fields. */
export const LiveSection = ({
    title,
    summary,
    children,
}: {
    title: string
    summary?: ReactNode
    children: ReactNode
}) => (
    <section aria-label={title} className="flex flex-col gap-3 border-t border-border pt-4">
        <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="m-0 text-sm font-medium text-foreground">{title}</h3>
            {summary ? (
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    {summary}
                </span>
            ) : null}
        </header>
        {children}
    </section>
)
