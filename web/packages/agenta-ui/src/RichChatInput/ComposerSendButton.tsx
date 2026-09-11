import {type ReactNode} from "react"

import {ArrowUp} from "@phosphor-icons/react"

import {Button} from "../components/ui/button"
import {Spinner} from "../components/ui/spinner"
import {cn} from "../components/ui/utils"

export interface ComposerSendButtonProps {
    onClick?: () => void
    disabled?: boolean
    ariaLabel?: string
    /** Override the glyph when the primary action is a variant of sending (e.g. attaching a
     * recording to the message instead of sending it outright). */
    icon?: ReactNode
    /**
     * The send is in flight and has not landed yet — a create that is still minting, a navigation
     * that has not committed. The arrow becomes a spinner and the button refuses a second press.
     */
    sending?: boolean
}

/**
 * The composer's primary action button.
 *
 * Presentational and Lexical-free on purpose: the send affordance appears both inside the editor
 * and on surfaces that overlay it (the voice recording bar), and those must be the same control —
 * a second, similar-but-different send button in the most-used flow in the product is worse than
 * any styling detail it might otherwise get right.
 */
export function ComposerSendButton({
    onClick,
    disabled,
    ariaLabel,
    icon,
    sending,
}: ComposerSendButtonProps) {
    return (
        <Button
            size="icon"
            variant="default"
            aria-label={sending ? "Sending" : (ariaLabel ?? "Send")}
            aria-busy={sending || undefined}
            disabled={disabled || sending}
            onClick={onClick}
            // Filled accent when there's something to send, a clearly-inert grey fill when empty
            // (never a faint outlined ghost).
            className={cn(
                // The control radius, not a circle: the composer is a rounded rectangle and every
                // other control on it follows that radius — a puck was the one round thing on it.
                "rounded-control",
                disabled
                    ? "!border-[var(--ag-send-disabled-bg)] !bg-[var(--ag-send-disabled-bg)] !text-[var(--ag-send-disabled-fg)]"
                    : // Re-toned by its CONTAINER, not by a prop: the button sits five levels below
                      // any host that might want a different fill, and threading a colour down
                      // that chain is how one control becomes two. Defaults to the brand accent.
                      "!border-[var(--ag-composer-send-bg,var(--ag-surface-accent))] !bg-[var(--ag-composer-send-bg,var(--ag-surface-accent))] !text-[var(--ag-composer-send-fg,#191a0d)] hover:!border-[var(--ag-composer-send-hover-bg,#b8cb3f)] hover:!bg-[var(--ag-composer-send-hover-bg,#b8cb3f)]",
            )}
        >
            {sending ? (
                <Spinner size="small" className="text-current" />
            ) : (
                (icon ?? <ArrowUp size={16} weight="bold" />)
            )}
        </Button>
    )
}
