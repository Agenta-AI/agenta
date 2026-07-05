import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "@agenta/primitive-ui/lib/utils"

const alertVariants = cva(
    "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
    {
        variants: {
            variant: {
                default: "bg-card text-card-foreground",
                destructive:
                    "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
                success:
                    "border-green-2 bg-green-1 text-green-7 *:data-[slot=alert-description]:text-green-7/90 *:[svg]:text-current",
                warning:
                    "border-amber-2 bg-amber-1 text-amber-7 *:data-[slot=alert-description]:text-amber-7/90 *:[svg]:text-current",
                info: "border-blue-2 bg-blue-1 text-blue-7 *:data-[slot=alert-description]:text-blue-7/90 *:[svg]:text-current",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
)

function Alert({
    className,
    variant,
    closable,
    onClose,
    icon,
    children,
    ...props
}: React.ComponentProps<"div"> &
    VariantProps<typeof alertVariants> & {
        closable?: boolean
        onClose?: () => void
        icon?: React.ReactNode
    }) {
    return (
        <div
            data-slot="alert"
            role="alert"
            className={cn(alertVariants({variant}), className)}
            {...props}
        >
            {icon}
            {children}
            {closable && (
                <AlertAction>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex items-center justify-center rounded-md p-1 opacity-70 hover:opacity-100 transition-opacity"
                        aria-label="Close"
                    >
                        <XIcon />
                    </button>
                </AlertAction>
            )}
        </div>
    )
}

function AlertTitle({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-title"
            className={cn(
                "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
                className,
            )}
            {...props}
        />
    )
}

function AlertDescription({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-description"
            className={cn(
                "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
                className,
            )}
            {...props}
        />
    )
}

function AlertAction({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-action"
            className={cn("absolute top-2 end-2", className)}
            {...props}
        />
    )
}

function XIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

export {Alert, AlertTitle, AlertDescription, AlertAction}
