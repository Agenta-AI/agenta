import * as React from "react"

import {Inbox} from "lucide-react"

import {Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "./empty"
import {cn} from "./utils"

/**
 * EmptyState — antd Empty's props over the shadcn Empty parts. `image="default"|"simple"` both
 * render the icon tile ("simple" just tightens the padding); a ReactNode `image` is the media slot.
 */
export interface EmptyStateProps extends Omit<
    React.HTMLAttributes<HTMLDivElement>,
    "children" | "title"
> {
    /** `"default"` · `"simple"` (compact) · a custom ReactNode illustration. */
    image?: "default" | "simple" | React.ReactNode
    /** Headline above the description. */
    title?: React.ReactNode
    description?: React.ReactNode
    /** Actions, rendered below the text. */
    children?: React.ReactNode
}

export function EmptyState({
    className,
    image = "default",
    title,
    description,
    children,
    ...props
}: EmptyStateProps) {
    const isPreset = image === "default" || image === "simple"
    return (
        <Empty
            data-slot="empty-state"
            className={cn(image === "simple" && "gap-3 p-4", className)}
            {...props}
        >
            <EmptyHeader>
                {isPreset ? (
                    <EmptyMedia variant="icon">
                        <Inbox />
                    </EmptyMedia>
                ) : image != null ? (
                    <EmptyMedia>{image}</EmptyMedia>
                ) : null}
                {title != null ? <EmptyTitle>{title}</EmptyTitle> : null}
                {description != null ? <EmptyDescription>{description}</EmptyDescription> : null}
            </EmptyHeader>
            {children != null ? <EmptyContent>{children}</EmptyContent> : null}
        </Empty>
    )
}
