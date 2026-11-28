import {Fragment, useRef, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import {SimpleTooltip} from "@agenta/ui/composed"
import {BottomSheetMenu, useIsPhone} from "@agenta/ui/phone"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Switch,
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
    /** Draws a switch in this state; selecting flips it and leaves the menu open. */
    checked?: boolean
    onClick: () => void
}

export type SettingsRowMenuItem = SettingsRowAction | {type: "divider"}

/** Drops hidden items, puts a divider before a destructive one (ACT-03), trims stray dividers. */
const visibleItems = (items: SettingsRowMenuItem[]): SettingsRowMenuItem[] => {
    const kept = items.filter((item) => "type" in item || !item.hidden)
    const shown = kept.flatMap<SettingsRowMenuItem>((item, index) =>
        !("type" in item) && item.danger && index > 0 && !("type" in kept[index - 1])
            ? [{type: "divider"}, item]
            : [item],
    )
    return shown.filter(
        (item, index) =>
            !("type" in item) ||
            (shown.slice(0, index).some((prior) => !("type" in prior)) &&
                shown.slice(index + 1).some((next) => !("type" in next))),
    )
}

/** A Settings row's kebab; renders nothing when every item is hidden. A phone opens it as a sheet. */
export const SettingsRowMenu = ({items, label}: {items: SettingsRowMenuItem[]; label?: string}) => {
    const t = useT(settingsSharedCatalog)
    const phone = useIsPhone()
    const [sheetOpen, setSheetOpen] = useState(false)
    const shown = visibleItems(items)
    // Radix restores focus to the trigger on close, which would blur a field the verb just focused.
    const deferredRef = useRef<(() => void) | null>(null)
    if (!shown.some((item) => !("type" in item))) return null
    const menuLabel = label ?? t("settings.shared.rowActions")

    if (phone)
        return (
            <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                <BottomSheetMenu
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    title={menuLabel}
                    showTitle={false}
                    onCloseAutoFocus={(event) => {
                        const deferred = deferredRef.current
                        deferredRef.current = null
                        if (!deferred) return
                        event.preventDefault()
                        deferred()
                    }}
                    trigger={
                        <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={menuLabel}
                            className="hover:bg-accent"
                        >
                            <DotsThreeVertical aria-hidden />
                        </Button>
                    }
                    items={shown.flatMap((item) =>
                        "type" in item
                            ? []
                            : [
                                  {
                                      key: item.key,
                                      label:
                                          item.checked === undefined ? (
                                              item.label
                                          ) : (
                                              <span className="inline-flex items-center gap-2">
                                                  {item.label}
                                                  <Switch
                                                      size="sm"
                                                      checked={item.checked}
                                                      tabIndex={-1}
                                                      aria-hidden
                                                      className="pointer-events-none"
                                                  />
                                              </span>
                                          ),
                                      icon: item.icon,
                                      disabled: item.disabled,
                                      onSelect: () => {
                                          if (item.deferred) deferredRef.current = item.onClick
                                          else item.onClick()
                                      },
                                  },
                              ],
                    )}
                />
            </span>
        )

    return (
        // A row opens on click, so the menu must not open the row as well.
        <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenu>
                <SimpleTooltip title={menuLabel}>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={menuLabel}
                            // Accent is translucent, so on the row's accent hover it still shows.
                            className={`hover:bg-accent`}
                        >
                            <DotsThreeVertical aria-hidden />
                        </Button>
                    </DropdownMenuTrigger>
                </SimpleTooltip>
                <DropdownMenuContent
                    align="end"
                    className="min-w-60"
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
                                    // Quiet until the confirm (ACT-03): the dialog carries the red.
                                    disabled={item.disabled}
                                    onSelect={(event) => {
                                        if (item.checked !== undefined) event.preventDefault()
                                        if (item.deferred) deferredRef.current = item.onClick
                                        else item.onClick()
                                    }}
                                >
                                    {item.icon}
                                    {item.label}
                                    {item.checked !== undefined ? (
                                        <Switch
                                            size="sm"
                                            checked={item.checked}
                                            tabIndex={-1}
                                            aria-hidden
                                            className="pointer-events-none ml-auto"
                                        />
                                    ) : null}
                                </DropdownMenuItem>
                            </Fragment>
                        ),
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </span>
    )
}
