import type {ReactNode} from "react"

/** One numbered step of a connect flow, with a rail to the next. */
export const SignInStep = ({
    index,
    title,
    last,
    children,
}: {
    index: number
    title: ReactNode
    last?: boolean
    children: ReactNode
}) => (
    <li className="flex gap-3">
        <span className="flex flex-col items-center">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-solid border-border bg-background text-[12px] font-medium text-foreground">
                {index}
            </span>
            {last ? null : <span aria-hidden className="my-1 w-px flex-1 bg-border" />}
        </span>
        <span
            className={
                last
                    ? "flex min-w-0 flex-1 flex-col gap-2"
                    : "flex min-w-0 flex-1 flex-col gap-1 pb-4"
            }
        >
            <span className="text-sm font-medium leading-6 text-foreground">{title}</span>
            {children}
        </span>
    </li>
)
