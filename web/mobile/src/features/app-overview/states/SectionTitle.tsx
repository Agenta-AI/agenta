import type {ReactNode} from "react"

/** The heading row of an overview section. `action` sits at the end of the row. */
export const SectionTitle = ({title, action}: {title: ReactNode; action?: ReactNode}) => (
    <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <h2 className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] text-foreground">
            {title}
        </h2>
        {action}
    </div>
)
