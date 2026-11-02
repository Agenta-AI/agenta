import type {ReactNode} from "react"

/** A numbered section of the template page: the number and title on a rail, the body beside it. */
export const TemplateSection = ({
    number,
    title,
    children,
}: {
    number: number
    title: string
    children: ReactNode
}) => (
    <section className="grid grid-cols-1 gap-3 border-x-0 border-b border-t-0 border-solid border-border py-7 last:border-b-0 md:grid-cols-[120px_minmax(0,1fr)] md:gap-6">
        <h2 className="m-0 flex items-baseline gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-foreground md:flex-col md:gap-1.5 md:pt-0.5">
            <span aria-hidden className="text-muted-foreground font-mono text-[11px] font-medium">
                {String(number).padStart(2, "0")}
            </span>
            {title}
        </h2>
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
)
