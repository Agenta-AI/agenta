import type {ComponentProps, ReactNode} from "react"

import {cn} from "@agenta/ui/ui"

/**
 * A Settings configuration group: a small heading, then its rows in one framed card. The rows
 * are divided by rules, so each setting reads as its own line with its control on the right.
 */
export const SettingsSection = ({
    title,
    description,
    danger = false,
    children,
    className,
    ...rest
}: {
    title: ReactNode
    description?: ReactNode
    /** The red frame and heading of a section whose rows cannot be undone. */
    danger?: boolean
    children: ReactNode
} & Omit<ComponentProps<"section">, "title">) => (
    <section className={cn("flex flex-col gap-3", className)} {...rest}>
        <div className="flex flex-col gap-0.5">
            <h2
                className={cn(
                    "m-0 text-[13px] font-medium leading-[18px]",
                    danger ? "text-colorError" : "text-muted-foreground",
                )}
            >
                {title}
            </h2>
            {description ? (
                <p className="m-0 text-[13px] text-muted-foreground">{description}</p>
            ) : null}
        </div>
        <div
            className={cn(
                "flex flex-col divide-y divide-solid overflow-hidden rounded-[10px] border border-solid bg-background",
                danger
                    ? "border-colorErrorBorder divide-colorErrorBorder"
                    : "border-border divide-border",
            )}
        >
            {children}
        </div>
    </section>
)

/** One setting in a {@link SettingsSection}: what it is on the left, its control on the right. */
export const SettingsRow = ({
    title,
    description,
    control,
    children,
    className,
    ...rest
}: {
    title: ReactNode
    description?: ReactNode
    control?: ReactNode
    /** Drawn under the label, e.g. why the control is locked. */
    children?: ReactNode
} & Omit<ComponentProps<"div">, "title">) => (
    <div
        className={cn("flex flex-wrap items-center gap-x-6 gap-y-3 px-[18px] py-4", className)}
        {...rest}
    >
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
            <span className="font-medium text-foreground">{title}</span>
            {description ? (
                <span className="text-[13px] text-muted-foreground">{description}</span>
            ) : null}
            {children}
        </div>
        {control ? <div className="flex shrink-0 items-center gap-2">{control}</div> : null}
    </div>
)
