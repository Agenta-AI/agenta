import * as React from "react"

import {cn} from "../../foundation/utils/cn"
import {SkeletonBlock} from "../../primitives/skeleton"

/** The name as a field: the title's own text style, a hover fill, and the field's focus ring. */
export type ItemViewTitleEditable = Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "className"
> & {
    value: string
    onChange: (next: string) => void
    /** Marks the field and shows under the title. */
    error?: string
    inputRef?: React.Ref<HTMLInputElement>
}

export interface ItemViewTitleProps {
    /** A 24px Mark (`IconTile size={24}` or an entity's own Mark at 24px). */
    mark: React.ReactNode
    title: string
    /** The name is edited in place. `title` stays the read-only fallback. */
    editable?: ItemViewTitleEditable
    /** One quiet line under the title. */
    description?: React.ReactNode
    /** After the name: a badge or a state. */
    status?: React.ReactNode
    /** At the end of the line: a switch, Run now, a menu. */
    actions?: React.ReactNode
    /** Layout only (the view's padding). */
    className?: string
}

/** An item view's title: 24px Mark, name, status, actions, one line under (CONS-02); the pane header hides its own title while it shows. */
export function ItemViewTitle({
    mark,
    title,
    editable,
    description,
    status,
    actions,
    className,
}: ItemViewTitleProps) {
    const errorId = React.useId()
    let name: React.ReactNode
    if (editable) {
        const {value, onChange, error, inputRef, ...input} = editable
        name = (
            // Hangs 4px left, so the typed text stays where the read-only name sits.
            <input
                ref={inputRef}
                {...input}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-invalid={error ? true : input["aria-invalid"]}
                aria-describedby={error ? errorId : input["aria-describedby"]}
                className={cn(
                    "-mx-1 box-border h-6 min-w-0 flex-1 truncate rounded-sm border border-solid bg-transparent px-1 py-0 font-[inherit] text-label font-semibold leading-5 text-foreground",
                    "transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none",
                    "placeholder:font-medium placeholder:text-muted-foreground focus-ring-field disabled:opacity-60",
                    error ? "border-destructive" : "border-transparent",
                    !input.disabled && "hover:bg-accent",
                )}
            />
        )
    } else {
        name = (
            <h2
                title={title}
                className="m-0 min-w-0 flex-1 truncate text-label font-semibold leading-5 text-foreground"
            >
                {title}
            </h2>
        )
    }
    const error = editable?.error
    return (
        <div data-item-view-title="" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
            <div className="flex min-h-6 min-w-0 items-center gap-2">
                <span aria-hidden className="flex shrink-0">
                    {mark}
                </span>
                {name}
                {status}
                {actions ? (
                    <span className="flex shrink-0 items-center gap-1.5">{actions}</span>
                ) : null}
            </div>
            {error ? (
                <p id={errorId} className="m-0 text-meta text-destructive">
                    {error}
                </p>
            ) : null}
            {description ? (
                <div className="min-w-0 text-meta text-muted-foreground">{description}</div>
            ) : null}
        </div>
    )
}

/** The loading shape of `ItemViewTitle` (STATE-02): the Mark, the name, and the line under it. */
export function ItemViewTitleSkeleton({
    description = true,
    actions,
    className,
}: {
    description?: boolean
    /** Placeholders at the end of the line, as the loaded view draws its actions. */
    actions?: React.ReactNode
    className?: string
}) {
    return (
        <div data-item-view-title="" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
            <div className="flex min-h-6 min-w-0 items-center gap-2">
                <SkeletonBlock shape="mark" className="size-6 shrink-0" />
                <div className="flex h-5 min-w-0 flex-1 items-center">
                    <SkeletonBlock className="h-3.5 w-32" />
                </div>
                {actions}
            </div>
            {description ? (
                <div className="flex h-4 items-center">
                    <SkeletonBlock className="h-3 w-3/5" />
                </div>
            ) : null}
        </div>
    )
}
