/**
 * What the chat renders in place of a link it refuses (#6666).
 *
 * `rehype-harden` already drops most bad targets and leaves this exact markup behind: a span
 * carrying the original target in its `title` and a trailing " [blocked]". One shape gets past
 * harden and has to be refused at the anchor instead, so it is rendered the same way. A reader
 * seeing two refused links in one reply should not be able to tell which layer caught which.
 */
import {type ReactNode} from "react"

/** Harden's own class for a blocked link. Kept literal so the two look identical. */
const BLOCKED_LINK_CLASS = "text-gray-500"

export const BlockedChatLink = ({
    href,
    className,
    children,
}: {
    href?: string
    className?: string
    children?: ReactNode
}) => (
    <span
        title={`Blocked URL: ${href ?? ""}`}
        className={className ? `${BLOCKED_LINK_CLASS} ${className}` : BLOCKED_LINK_CLASS}
    >
        {children} [blocked]
    </span>
)
