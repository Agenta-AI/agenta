import type {ReactNode} from "react"

import {cn} from "../foundation/utils/cn"

export interface EntityCardProps {
    /** Leading icon / logo slot (~28px). */
    icon?: ReactNode
    title: ReactNode
    /** Rendered right after the title (e.g. a status dot). */
    titleAdornment?: ReactNode
    /** 2-line clamped secondary text. */
    description?: ReactNode
    /** Category-style pills, rendered as-is (caller formats labels). */
    tags?: string[]
    /** Bottom-right meta slot (e.g. an action count, provider marks). */
    meta?: ReactNode
    onClick?: () => void
    /** "subtle" drops the resting border for a fill-based tile. @default "bordered" */
    variant?: "bordered" | "subtle"
    /** Min-height utility class. @default "min-h-28" */
    minHeightClassName?: string
    className?: string
    disabled?: boolean
}

/**
 * Catalog-style tile card: icon + title (+ adornment), a 2-line description, and a bottom row
 * of category pills + a right-aligned meta slot. Dark-safe (antd semantic tokens). Powers the
 * Composio app catalog and any other "pick from a grid of things" surface.
 */
export function EntityCard({
    icon,
    title,
    titleAdornment,
    description,
    tags,
    meta,
    onClick,
    variant = "bordered",
    minHeightClassName = "min-h-28",
    className,
    disabled,
}: EntityCardProps) {
    const shownTags = (tags ?? []).filter(Boolean)
    const surface =
        variant === "subtle"
            ? "border-transparent bg-secondary hover:border-border-muted hover:bg-accent"
            : "border-border bg-transparent hover:border-primary hover:bg-accent"

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "group flex h-full flex-col gap-2 rounded-lg border border-solid p-3 text-left",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                minHeightClassName,
                surface,
                className,
            )}
        >
            <div className="flex items-center gap-2.5">
                {icon}
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-label">{title}</span>
                    {titleAdornment}
                </div>
            </div>

            {description ? (
                <p className="m-0 line-clamp-2 text-meta text-muted-foreground">{description}</p>
            ) : (
                <span className="flex-1" />
            )}

            {shownTags.length > 0 || meta ? (
                <div className="mt-auto flex items-center gap-1.5">
                    {shownTags.map((tag) => (
                        <span
                            key={tag}
                            className="truncate rounded bg-secondary px-1.5 py-0.5 text-meta leading-none text-muted-foreground"
                        >
                            {tag}
                        </span>
                    ))}
                    {meta ? <span className="ml-auto shrink-0">{meta}</span> : null}
                </div>
            ) : null}
        </button>
    )
}
