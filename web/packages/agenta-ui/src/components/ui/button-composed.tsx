import * as React from "react"

import {LoaderCircle} from "lucide-react"

import {Button, type ButtonProps} from "./button"
import {cn} from "./utils"

/**
 * LoadingButton — Button with a busy state. Kept OUT of Button itself (stock shadcn's
 * Button has no `loading` prop); this is the composition instead.
 *
 * Behaviour matches antd rather than the usual `disabled={disabled || loading}` snippet:
 * a busy button keeps its variant's colours instead of taking the disabled skin. It must
 * therefore block activation itself — `pointer-events-none` stops the mouse, and the
 * click guard stops Enter/Space (which dispatch a click on a focused button) so a busy
 * submit button can't double-fire.
 */
export interface LoadingButtonProps extends ButtonProps {
    loading?: boolean
}

export function LoadingButton({
    loading = false,
    onClick,
    className,
    children,
    size,
    ...props
}: LoadingButtonProps) {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (loading) {
            event.preventDefault()
            event.stopPropagation()
            return
        }
        onClick?.(event)
    }

    return (
        <Button
            data-slot="loading-button"
            size={size}
            aria-busy={loading || undefined}
            aria-disabled={loading || undefined}
            onClick={handleClick}
            // antd dims a loading button to opacityLoading (0.65) on top of keeping its variant colors.
            className={cn(loading && "pointer-events-none opacity-[0.65]", className)}
            {...props}
        >
            {loading ? (
                // Sized by class, not lucide's `size` prop — the prop leaves the svg
                // em-scaled (17.9px) rather than the 12px glyph antd renders.
                <LoaderCircle
                    className={cn("animate-spin", size === "lg" ? "size-3.5" : "size-3")}
                />
            ) : null}
            {children}
        </Button>
    )
}
