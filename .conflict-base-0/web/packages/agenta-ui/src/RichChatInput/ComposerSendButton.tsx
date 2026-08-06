import {type ReactNode} from "react"

import {ArrowUp} from "@phosphor-icons/react"
import {Button} from "antd"

export interface ComposerSendButtonProps {
    onClick?: () => void
    disabled?: boolean
    ariaLabel?: string
    /** Override the glyph when the primary action is a variant of sending (e.g. attaching a
     * recording to the message instead of sending it outright). */
    icon?: ReactNode
}

/**
 * The composer's primary action button.
 *
 * Presentational and Lexical-free on purpose: the send affordance appears both inside the editor
 * and on surfaces that overlay it (the voice recording bar), and those must be the same control —
 * a second, similar-but-different send button in the most-used flow in the product is worse than
 * any styling detail it might otherwise get right.
 */
export function ComposerSendButton({onClick, disabled, ariaLabel, icon}: ComposerSendButtonProps) {
    return (
        <Button
            type="primary"
            shape="circle"
            aria-label={ariaLabel ?? "Send"}
            icon={icon ?? <ArrowUp size={16} weight="bold" />}
            disabled={disabled}
            onClick={onClick}
            // Filled accent when there's something to send, a clearly-inert grey fill when empty
            // (never a faint outlined ghost).
            className={
                disabled
                    ? "!border-[var(--ag-send-disabled-bg)] !bg-[var(--ag-send-disabled-bg)] !text-[var(--ag-send-disabled-fg)]"
                    : "!border-[var(--ag-surface-accent)] !bg-[var(--ag-surface-accent)] !text-[#191a0d] hover:!border-[#b8cb3f] hover:!bg-[#b8cb3f]"
            }
        />
    )
}
