import * as React from "react"

import {CheckCircle, Info, WarningCircle, XCircle, X} from "@phosphor-icons/react"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Alert — an @agenta/ui re-skin of antd `Alert`, presentational (plain div + cva, no Radix).
 * bg/border/icon colour resolve through the palette-derived `--ag-*` bridge, so they flip
 * light↔dark with the app theme. Geometry comes from the control scale + Tailwind spacing,
 * never raw pixels. `border-solid`/`box-border` are required (preflight is OFF app-wide).
 *
 * antd → @agenta/ui mapping (call-sites): type/message/description/showIcon/closable/onClose/
 * banner/icon all map 1:1. `action`/`afterClose` are not built — see Alert.md.
 */
const alertVariants = cva(
    [
        // CONTROL_RESET — preflight is off app-wide (see button.tsx).
        "box-border border-solid",
        "relative flex border text-colorTextHeading transition-colors",
        // 12px / 20px line-height (antd reset), pinned so it never inherits the ancestor size.
        "rounded-control-lg text-field-md",
    ],
    {
        variants: {
            type: {
                success: "bg-success-bg border-success-border",
                info: "bg-info-bg border-info-border",
                warning: "bg-warning-bg border-warning-border",
                error: "bg-error-bg border-error-border",
            },
            // antd: description grows padding (20/24) + top-aligns; else 8/12 + center.
            hasDescription: {
                true: "items-start px-6 py-5",
                false: "items-center px-3 py-2",
            },
            // antd banner: no border, no radius.
            banner: {true: "rounded-none border-0", false: ""},
        },
        defaultVariants: {type: "info", hasDescription: false, banner: false},
    },
)

// antd Alert icon colour = the semantic colour per type. warning = colorWarning (NOT
// colorWarningText, which `text-warning` maps to and diverges in dark).
const alertIconColor: Record<NonNullable<AlertProps["type"]>, string> = {
    success: "text-colorSuccess",
    info: "text-info",
    warning: "text-colorWarning",
    error: "text-colorError",
}

// antd default filled status icons (CheckCircle/Info/ExclamationCircle/CloseCircle equivalents).
const alertDefaultIcon: Record<NonNullable<AlertProps["type"]>, React.ReactNode> = {
    success: <CheckCircle weight="fill" />,
    info: <Info weight="fill" />,
    warning: <WarningCircle weight="fill" />,
    error: <XCircle weight="fill" />,
}

export interface AlertProps
    extends
        Omit<React.HTMLAttributes<HTMLDivElement>, "type">,
        Omit<VariantProps<typeof alertVariants>, "hasDescription"> {
    message?: React.ReactNode
    description?: React.ReactNode
    showIcon?: boolean
    closable?: boolean
    onClose?: React.MouseEventHandler<HTMLButtonElement>
    icon?: React.ReactNode
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
            className={cn(alertVariants({type: resolvedType, hasDescription, banner}), className)}
            {...props}
        >
            {iconVisible ? (
                <span
                    data-slot="alert-icon"
                    className={cn(
                        // marginXS (8px) + 12px icon / marginSM (12px) + 20px icon (measured).
                        "shrink-0 leading-none",
                        hasDescription ? "mr-3 [&_svg]:size-5" : "mr-2 [&_svg]:size-3",
                        alertIconColor[resolvedType],
                    )}
                >
                    {icon ?? alertDefaultIcon[resolvedType]}
                </span>
            ) : null}
            <div data-slot="alert-content" className="min-w-0 flex-1">
                {message != null ? (
                    <div
                        data-slot="alert-title"
                        // antd: with a description the title grows to fontSizeLG (14px), not bold.
                        // leading ratio 1.6667 = antd's 23.33px line-height (field-lg ships 1.5714).
                        className={cn(
                            hasDescription &&
                                "mb-2 block text-field-lg leading-[1.6666666666666667]",
                        )}
                    >
                        {message}
                    </div>
                ) : null}
                {hasDescription ? (
                    <div data-slot="alert-description" className="text-colorText">
                        {description}
                    </div>
                ) : null}
            </div>
            {closable ? (
                <button
                    type="button"
                    data-slot="alert-close"
                    aria-label="Close"
                    onClick={onClose}
                    className="ml-2 shrink-0 cursor-pointer border-0 bg-transparent p-0 leading-none text-colorIcon transition-colors hover:text-colorIconHover [&_svg]:size-3"
                >
                    <X />
                </button>
            ) : null}
        </div>
    )
}

export {alertVariants}
