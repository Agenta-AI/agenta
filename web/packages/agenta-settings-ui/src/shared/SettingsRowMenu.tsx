import {Fragment, useRef, type ReactNode} from "react"

import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeVertical} from "@phosphor-icons/react"

export interface SettingsRowAction {
    key: string
    label: ReactNode
    icon?: ReactNode
    danger?: boolean
    disabled?: boolean
    /** Drop the item for this row, e.g. "Set as default" on the default row. */
    hidden?: boolean
    /** Run after the menu closes, for a verb that moves focus (an inline rename). */
    deferred?: boolean
    onClick: () => void
}

export type SettingsRowMenuItem = SettingsRowAction | {type: "divider"}

/** Hidden items are dropped, and a divider survives only with a real item on both sides. */
const visibleItems = (items: SettingsRowMenuItem[]): SettingsRowMenuItem[] => {
    const shown = items.filter((item) => "type" in item || !item.hidden)
    return shown.filter(
        (item, index) =>
            !("type" in item) ||
            (shown.slice(0, index).some((prior) => !("type" in prior)) &&
                shown.slice(index + 1).some((next) => !("type" in next))),
    )
}

/**
 * A settings row's kebab: every row verb that is not the row click. Renders nothing when a host
 * hides every verb, because an empty menu is worse than no menu.
 */
export const SettingsRowMenu = ({
    items,
    label = "Row actions",
}: {
    items: SettingsRowMenuItem[]
    label?: string
}) => {
    const shown = visibleItems(items)
    // Radix restores focus to the trigger on close, which would blur a field the verb just focused.
    const deferredRef = useRef<(() => void) | null>(null)
    if (!shown.some((item) => !("type" in item))) return null

    return (
        // A row opens on click, so the menu must not open the row as well.
        <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={label}
                        // The row already hovers to accent; an accent button on it would not show.
                        className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
                    >
                        <DotsThreeVertical aria-hidden weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="end"
                    className="min-w-[180px]"
                    onCloseAutoFocus={(event) => {
                        const deferred = deferredRef.current
                        deferredRef.current = null
                        if (!deferred) return
                        event.preventDefault()
                        deferred()
                    }}
                >
                    {shown.map((item, index) =>
                        "type" in item ? (
                            <DropdownMenuSeparator key={`divider-${index}`} />
                        ) : (
                            <Fragment key={item.key}>
                                <DropdownMenuItem
                                    variant={item.danger ? "destructive" : "default"}
                                    disabled={item.disabled}
                                    onSelect={() => {
                                        if (item.deferred) deferredRef.current = item.onClick
                                        else item.onClick()
                                    }}
                                >
                                    {item.icon}
                                    {item.label}
                                </DropdownMenuItem>
                            </Fragment>
                        ),
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </span>
    )
}
