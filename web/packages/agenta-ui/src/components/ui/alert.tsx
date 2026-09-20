import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"
import {CircleAlert, CircleCheck, Info, TriangleAlert, X} from "lucide-react"

import {cn} from "./utils"

/**
 * Alert — the shadcn alert (neutral card; `error` is the destructive variant) behind antd Alert's props.
 * Unlike shadcn, success/info/warning keep the status colour on the icon.
 */
const alertVariants = cva(
    [
        // CONTROL_RESET — preflight is off app-wide (see button.tsx).
        "box-border border-solid",
        "relative flex w-full items-start gap-2 border px-2.5 py-2 text-left text-sm",
        "bg-card text-card-foreground",
    ],
    {
        variants: {
            type: {
                success: "border-border",
                info: "border-border",
                warning: "border-border",
                // Error text, description at 90%.
                error: "border-border text-error [&_[data-slot=alert-description]]:text-[color:color-mix(in_srgb,var(--ag-colorError)_90%,transparent)]",
            },
            // antd banner: no border, no radius.
            banner: {true: "rounded-none border-0", false: "rounded-control-lg"},
        },
        defaultVariants: {type: "info", banner: false},
    },
)

// warning = colorWarning, not colorWarningText (which diverges in dark).
const alertIconColor: Record<NonNullable<AlertProps["type"]>, string> = {
    success: "text-colorSuccess",
    info: "text-info",
    warning: "text-colorWarning",
    error: "text-current",
}

const alertDefaultIcon: Record<NonNullable<AlertProps["type"]>, React.ReactNode> = {
    success: <CircleCheck />,
    info: <Info />,
    warning: <TriangleAlert />,
    error: <CircleAlert />,
}

export interface AlertProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "type">, VariantProps<typeof alertVariants> {
    message?: React.ReactNode
    description?: React.ReactNode
    showIcon?: boolean
    closable?: boolean
    onClose?: React.MouseEventHandler<HTMLButtonElement>
    icon?: React.ReactNode
    /**
     * A trailing control on the alert's own line: the reconnect link on an expired-login banner,
     * the retry on a failed probe. It is right aligned and never wraps, so the message reflows
     * around it rather than pushing it onto a second line.
     */
    action?: React.ReactNode
}

export function Alert({
    className,
    type = "info",
    message,
    description,
    showIcon,
    closable = false,
    onClose,
    banner = false,
    icon,
    action,
    ...props
}: AlertProps) {
    const resolvedType = type ?? "info"
    const hasDescription = Boolean(description)
    // antd: banner defaults showIcon to true unless explicitly set.
    const iconVisible = showIcon ?? banner
    return (
        <div
            data-slot="alert"
            role="alert"
            className={cn(
                alertVariants({type: resolvedType, banner}),
                banner && "px-2.5 py-2",
                className,
            )}
            {...props}
        >
            {iconVisible ? (
                <span
                    data-slot="alert-icon"
                    // Nudged 2px down to sit on the title line.
                    className={cn(
                        "flex size-4 shrink-0 translate-y-0.5 items-center justify-center [&_svg]:size-4",
                        alertIconColor[resolvedType],
                    )}
                >
                    {icon ?? alertDefaultIcon[resolvedType]}
                </span>
            ) : null}
            <div data-slot="alert-content" className="flex min-w-0 flex-1 flex-col gap-0.5">
                {message != null ? (
                    <div
                        data-slot="alert-title"
                        className="font-medium leading-5 [&_a]:underline [&_a]:underline-offset-[3px] [&_a:hover]:text-foreground"
                    >
                        {message}
                    </div>
                ) : null}
                {hasDescription ? (
                    <div
                        data-slot="alert-description"
                        className="text-sm text-muted-foreground [&_a]:underline [&_a]:underline-offset-[3px] [&_a:hover]:text-foreground [&_p:not(:last-child)]:mb-4"
                    >
                        {description}
                    </div>
                ) : null}
            </div>
            {action != null ? (
                <div
                    data-slot="alert-action"
                    className="flex shrink-0 items-center gap-2 self-center"
                >
                    {action}
                </div>
            ) : null}
            {closable ? (
                <button
                    type="button"
                    data-slot="alert-close"
                    aria-label="Close"
                    onClick={onClose}
                    className="flex size-4 shrink-0 translate-y-0.5 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-4"
                >
                    <X />
                </button>
            ) : null}
        </div>
    )
}

export {alertVariants}
