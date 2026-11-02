import * as React from "react"

import {LoaderCircle} from "lucide-react"

import {Button, type ButtonProps} from "./button"
import {cn} from "./utils"

/**
 * LoadingButton — Button with a busy state. Kept OUT of Button itself (stock shadcn's
 * Button has no `loading` prop); this is the composition instead.
 *
 * A busy button keeps its variant's colours instead of taking the disabled skin, so it
 * must block activation itself — `pointer-events-none` stops the mouse, and the click
 * guard stops Enter/Space (which dispatch a click on a focused button) so a busy submit
 * button can't double-fire.
 */
export interface LoadingButtonProps extends ButtonProps {
    loading?: boolean
}

export function LoadingButton({
    loading = false,
    onClick,
    className,
    children,
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
            aria-busy={loading || undefined}
            aria-disabled={loading || undefined}
            onClick={handleClick}
            className={cn(loading && "pointer-events-none", className)}
            {...props}
        >
            {/* No size class: the Button's per-size svg rule sizes the spinner like any glyph. */}
            {loading ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
            {children}
        </Button>
    )
}
