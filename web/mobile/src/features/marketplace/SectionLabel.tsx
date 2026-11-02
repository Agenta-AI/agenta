import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

/** The marketplace's small uppercase label over a group: "Connects", "Example run", "Apps". */
export const SectionLabel = ({
    as: Tag = "span",
    id,
    className,
    children,
}: {
    as?: "span" | "h3"
    id?: string
    className?: string
    children: ReactNode
}) => (
    <Tag
        id={id}
        className={cn(
            "text-muted-foreground m-0 text-[11px] font-semibold uppercase tracking-wide",
            className,
        )}
    >
        {children}
    </Tag>
)
