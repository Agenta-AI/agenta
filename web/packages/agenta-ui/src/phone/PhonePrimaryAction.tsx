import type {ReactNode} from "react"

import {Button} from "../components/ui/button"
import {Spinner} from "../components/ui/spinner"
import {cn} from "../components/ui/utils"

import {PHONE_BUTTON_CLASS} from "./phoneButton"

export interface PhonePrimaryActionProps {
    /** The label ("Add integration"). */
    children: ReactNode
    /** A 14 px icon before the label (for example a plus). */
    icon?: ReactNode
    onClick: () => void
    disabled?: boolean
    /** Shows a spinner and takes no tap. */
    loading?: boolean
    className?: string
}

/**
 * The one primary action of a list screen on a phone, as a full-width button at the bottom of the
 * screen, clear of the home indicator (COMPACT-05). Place it as the last child of the screen's column: it sticks to the bottom edge
 * while the list scrolls. On the desktop the same action stays an outlined button at the top
 * right of the section, so a list renders this only on a phone (`useIsPhone`).
 */
export const PhonePrimaryAction = ({
    children,
    icon,
    onClick,
    disabled,
    loading,
    className,
}: PhonePrimaryActionProps) => (
    <div
        data-testid="phone-primary-action"
        className={cn(
            "sticky bottom-0 mt-auto flex shrink-0 border-0 border-t border-solid border-border-muted bg-background px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3",
            className,
        )}
    >
        <Button
            className={PHONE_BUTTON_CLASS}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            onClick={onClick}
        >
            {loading ? <Spinner size="small" /> : icon}
            {children}
        </Button>
    </div>
)
