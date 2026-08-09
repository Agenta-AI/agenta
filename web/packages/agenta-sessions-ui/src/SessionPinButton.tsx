import {PushPinIcon} from "@phosphor-icons/react"
import clsx from "clsx"

import {Tip} from "./assets/Tip"

/**
 * Pin and unpin as ONE control: a pinned row keeps the same pin, filled, and its tooltip reads
 * "Unpin". A separate unpin glyph made the pinned state look like a fault to undo.
 */
export const SessionPinButton = ({
    pinned,
    onToggle,
    revealOnHover = true,
}: {
    pinned: boolean
    onToggle: () => void
    /** Web reveals an unpinned row's pin on hover; touch has no hover, so it stays visible there. */
    revealOnHover?: boolean
}) => (
    <Tip title={pinned ? "Unpin" : "Pin"}>
        <button
            type="button"
            aria-label={pinned ? "Unpin session" : "Pin session"}
            onClick={(event) => {
                event.stopPropagation()
                onToggle()
            }}
            className={clsx(
                "relative shrink-0 cursor-pointer border-0 bg-transparent p-0 text-colorTextTertiary",
                // Transparent ::after hit extender: a ~26px pointer target around the unchanged
                // 14px icon. Absolute, so the trailing controls' h-5 box and the row do not grow.
                "after:absolute after:inset-[-6px] after:content-['']",
                !pinned && revealOnHover && "opacity-0 focus:opacity-100 group-hover:opacity-100",
            )}
        >
            <PushPinIcon size={14} weight={pinned ? "fill" : "regular"} />
        </button>
    </Tip>
)
