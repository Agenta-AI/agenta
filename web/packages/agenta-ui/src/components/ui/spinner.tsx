import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"
import {LoaderCircle} from "lucide-react"

import {cn} from "./utils"

/**
 * Spinner — shadcn's spinner (lucide LoaderCircle, inherits currentColor), keeping antd's
 * `size` (14/16/24px) and `tip`. Without `tip` it is the bare svg; with it, a centred column.
 */
const spinnerVariants = cva("shrink-0 animate-spin", {
    variants: {
        size: {
            small: "size-3.5",
            default: "size-4",
            large: "size-6",
        },
    },
    defaultVariants: {size: "default"},
})

export type SpinnerSize = "small" | "default" | "large"

export interface SpinnerProps
    extends
        Omit<React.SVGProps<SVGSVGElement>, "children" | "ref">,
        VariantProps<typeof spinnerVariants> {
    ref?: React.Ref<SVGSVGElement>
    /** Optional label rendered under the indicator (antd `tip`/`description`). */
    tip?: React.ReactNode
    /** Accessible label announced by screen readers. */
    "aria-label"?: string
}

export function Spinner({
    className,
    size = "default",
    tip,
    "aria-label": ariaLabel = "Loading",
    ...props
}: SpinnerProps) {
    const icon = (
        <LoaderCircle
            data-slot="spinner"
            role="status"
            aria-label={ariaLabel}
            className={cn(spinnerVariants({size}), tip == null && className)}
            {...props}
        />
    )
    if (tip == null) return icon
    return (
        <span
            data-slot="spinner-with-tip"
            className={cn("box-border inline-flex flex-col items-center gap-3", className)}
        >
            {icon}
            <span data-slot="spinner-tip" className="text-sm leading-none">
                {tip}
            </span>
        </span>
    )
}

export {spinnerVariants}
