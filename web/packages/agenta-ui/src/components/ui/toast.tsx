import * as React from "react"

import {CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert} from "lucide-react"
import {Toaster as Sonner, type ToasterProps} from "sonner"

/**
 * Toaster — shadcn's Sonner toaster, themed through the token bridge; `message.*` drives it.
 * The theme is read off the `.dark` class on <html> instead of next-themes.
 */

const readTheme = (): "light" | "dark" =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
        ? "dark"
        : "light"

const useDocumentTheme = () => {
    const [theme, setTheme] = React.useState<"light" | "dark">("light")
    React.useEffect(() => {
        setTheme(readTheme())
        const observer = new MutationObserver(() => setTheme(readTheme()))
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ["class"]})
        return () => observer.disconnect()
    }, [])
    return theme
}

function Toaster({style, ...props}: ToasterProps) {
    const theme = useDocumentTheme()
    return (
        <Sonner
            theme={theme}
            position="top-center"
            className="toaster group"
            // Status-coloured icons: most toasts are one line, so the colour carries the type.
            icons={{
                success: <CircleCheck className="size-4 text-colorSuccess" />,
                info: <Info className="size-4 text-info" />,
                warning: <TriangleAlert className="size-4 text-colorWarning" />,
                error: <OctagonX className="size-4 text-colorError" />,
                loading: <LoaderCircle className="size-4 animate-spin text-info" />,
            }}
            style={
                {
                    // Sonner's `--normal-*` hooks on the shared palette layer; the font is stated
                    // because the stack mounts outside the app's font wrapper.
                    "--normal-bg": "var(--ag-colorBgElevated)",
                    "--normal-text": "var(--ag-colorText)",
                    // The secondary border matches shadcn's neutral-200; the primary reads too heavy.
                    "--normal-border": "var(--ag-colorBorderSecondary)",
                    // shadcn's `var(--radius)`: 10px on both apps.
                    "--border-radius": "10px",
                    fontFamily:
                        "var(--font-inter, var(--font-sans, var(--ant-font-family, system-ui, sans-serif)))",
                    ...style,
                } as React.CSSProperties
            }
            {...props}
        />
    )
}

export {Toaster}
