import type {ReactNode} from "react"

import {ArrowRight} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

/** A way to start, styled like a template card: icon tiles, what it does, and where it leads. */
export const FeatureActionCard = ({
    icons = [],
    media,
    title,
    description,
    actionLabel,
    meta,
    onClick,
}: {
    icons?: ReactNode[]
    /** Drawn as-is in place of the icon tiles, e.g. an agent's own chip. */
    media?: ReactNode
    title: string
    description: string
    actionLabel: string
    meta: string
    onClick: () => void
}) => (
    <button
        type="button"
        onClick={onClick}
        className="box-border flex min-w-0 cursor-pointer flex-col rounded-lg border border-solid border-border-muted bg-background px-4 pb-0 pt-4 text-left transition-colors hover:bg-[image:linear-gradient(var(--accent),var(--accent))] focus-ring"
    >
        <span className="flex h-8 items-center">
            {media}
            {icons.map((icon, index) => (
                <span
                    key={index}
                    aria-hidden
                    className={cn(
                        "box-border inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-solid border-border-muted bg-background text-foreground",
                        index > 0 && "-ml-1.5",
                    )}
                >
                    {icon}
                </span>
            ))}
        </span>
        <span className="mt-3 text-title text-foreground">{title}</span>
        <span className="mt-1.5 line-clamp-2 min-h-11 text-body text-muted-foreground">
            {description}
        </span>
        <span className="mt-3 flex h-10 items-center justify-between gap-3 border-0 border-t border-solid border-border-muted text-label text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{actionLabel}</span>
            </span>
            <span className="shrink-0">{meta}</span>
        </span>
    </button>
)
