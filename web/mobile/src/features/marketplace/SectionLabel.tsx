import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

/** The marketplace's small label over a group: "Connects", "Example run", "Apps". */
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
    <Tag id={id} className={cn("text-muted-foreground m-0 text-meta", className)}>
        {children}
    </Tag>
)
