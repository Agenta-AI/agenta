"use client"

import {
    CheckCircleIcon,
    InfoIcon,
    WarningIcon,
    XCircleIcon,
    SpinnerIcon,
} from "@phosphor-icons/react"
import {Toaster as Sonner, type ToasterProps} from "sonner"

// Theme comes from the host app (Agenta uses its own ThemeContextProvider, not next-themes).
const Toaster = ({theme = "system", ...props}: ToasterProps) => {
    return (
        <Sonner
            theme={theme}
            className="toaster group"
            icons={{
                success: <CheckCircleIcon className="size-4" />,
                info: <InfoIcon className="size-4" />,
                warning: <WarningIcon className="size-4" />,
                error: <XCircleIcon className="size-4" />,
                loading: <SpinnerIcon className="size-4 animate-spin" />,
            }}
            style={
                {
                    "--normal-bg": "var(--popover)",
                    "--normal-text": "var(--popover-foreground)",
                    "--normal-border": "var(--border)",
                    "--border-radius": "var(--radius)",
                } as React.CSSProperties
            }
            toastOptions={{
                classNames: {
                    toast: "cn-toast",
                },
            }}
            {...props}
        />
    )
}

export {Toaster}
