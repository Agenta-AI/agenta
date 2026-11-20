import {useContext, type MouseEvent} from "react"

import {SidebarLayoutContext} from "@agenta/navigation-ui"
import {PlusIcon} from "@phosphor-icons/react"
import Link from "next/link"

/**
 * "New session" and "New chat": a full-width outlined button under the sidebar's header. A link,
 * so a modified or middle click opens the bare page in another tab; a plain click runs `onPlainClick`
 * in place of following the link.
 * Collapsed, it is the plus alone.
 */
export const SidebarNewButton = ({
    label,
    href,
    collapsed,
    onPlainClick,
}: {
    label: string
    href: string
    collapsed: boolean
    onPlainClick?: () => void
}) => {
    const phone = useContext(SidebarLayoutContext) === "phone"
    const onClick = onPlainClick
        ? (event: MouseEvent) => {
              if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
              )
                  return
              event.preventDefault()
              onPlainClick()
          }
        : undefined
    if (collapsed)
        return (
            <div className="flex w-full shrink-0 justify-center pt-2">
                <Link
                    href={href}
                    onClick={onClick}
                    aria-label={label}
                    title={label}
                    className="flex size-7 items-center justify-center rounded-sm !text-foreground no-underline hover:bg-muted"
                >
                    <PlusIcon size={16} />
                </Link>
            </div>
        )
    return (
        <div className={`w-full shrink-0 px-2 ${phone ? "pb-1 pt-1" : "pb-1 pt-2"}`}>
            <Link
                href={href}
                onClick={onClick}
                className={`flex w-full items-center justify-center gap-1.5 bg-background font-medium !text-foreground no-underline shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted ${phone ? "h-11 rounded-lg text-[15px] leading-5" : "h-8 rounded-md text-sm"}`}
            >
                <PlusIcon size={14} aria-hidden />
                {label}
            </Link>
        </div>
    )
}
