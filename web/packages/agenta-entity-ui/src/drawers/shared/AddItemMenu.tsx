/**
 * AddItemMenu
 *
 * Shared "+ add" popover for entity config sections (tools + triggers): grouped rows with an
 * icon, title, optional subtitle, and a chevron for rows that open a drawer. Data-driven — each
 * caller passes `groups`; the menu owns open/close and fires `onSelect` after closing.
 *
 * Keeps the tools and triggers add-menus visually identical. Dark-safe (`--ag-color*` tokens).
 */
import {memo, useCallback, useState, type ReactNode} from "react"

import {CaretRight, Plus} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip, Typography} from "antd"

export interface AddItemMenuItem {
    key: string
    icon: ReactNode
    title: string
    subtitle?: string
    /** Show a trailing chevron — the row opens a drawer rather than acting inline. */
    opensDrawer?: boolean
    disabled?: boolean
    /** Tooltip shown when `disabled` (e.g. "Coming soon"). */
    disabledHint?: string
    onSelect?: () => void
}

export interface AddItemGroup {
    /** Uppercase section label; omit for an unlabeled group. */
    label?: string
    items: AddItemMenuItem[]
}

function GroupLabel({children}: {children: ReactNode}) {
    return (
        <Typography.Text className="block px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
            {children}
        </Typography.Text>
    )
}

function Row({item, onPick}: {item: AddItemMenuItem; onPick: (item: AddItemMenuItem) => void}) {
    const body = (
        <button
            type="button"
            disabled={item.disabled}
            onClick={() => !item.disabled && onPick(item)}
            className={`flex w-full items-center gap-2.5 rounded-md border-none bg-transparent px-2 py-1.5 text-left [font:inherit] ${
                item.disabled
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer hover:bg-[var(--ag-colorFillTertiary)]"
            }`}
        >
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[var(--ag-colorTextSecondary)]">
                {item.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-xs text-[var(--ag-colorText)]">{item.title}</span>
                {item.subtitle ? (
                    <span className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                        {item.subtitle}
                    </span>
                ) : null}
            </span>
            {item.opensDrawer ? (
                <CaretRight size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
            ) : null}
        </button>
    )
    // A disabled <button> swallows mouse events, so wrap it in a span for the tooltip to trigger.
    return item.disabled && item.disabledHint ? (
        <Tooltip title={item.disabledHint}>
            <span className="block cursor-not-allowed">{body}</span>
        </Tooltip>
    ) : (
        body
    )
}

export const AddItemMenu = memo(function AddItemMenu({
    groups,
    trigger,
    disabled = false,
    ariaLabel = "Add",
    minWidth = 288,
}: {
    groups: AddItemGroup[]
    /** Custom trigger element (e.g. an inline text-link). Defaults to a `+` text button. */
    trigger?: ReactNode
    disabled?: boolean
    ariaLabel?: string
    minWidth?: number
}) {
    const [open, setOpen] = useState(false)

    const handlePick = useCallback((item: AddItemMenuItem) => {
        setOpen(false)
        item.onSelect?.()
    }, [])

    const content = (
        <div
            className="rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgElevated)] p-1.5 shadow-sm"
            style={{minWidth}}
        >
            {groups.map((group, gi) => (
                <div key={group.label ?? `group-${gi}`}>
                    {gi > 0 && (
                        <div className="mx-2 my-1.5 h-px bg-[var(--ag-colorBorderSecondary)]" />
                    )}
                    {group.label ? <GroupLabel>{group.label}</GroupLabel> : null}
                    {group.items.map((item) => (
                        <Row key={item.key} item={item} onPick={handlePick} />
                    ))}
                </div>
            ))}
        </div>
    )

    return (
        <Dropdown
            open={!disabled && open}
            onOpenChange={(next) => {
                if (disabled) return
                setOpen(next)
            }}
            trigger={["click"]}
            placement="bottomLeft"
            arrow={false}
            menu={{items: []}}
            popupRender={() => content}
            classNames={{root: "[&_.ant-dropdown-menu]:hidden [&_.ant-dropdown]:p-0"}}
        >
            {trigger ?? (
                <Button
                    type="text"
                    icon={<Plus size={16} />}
                    aria-label={ariaLabel}
                    disabled={disabled}
                    onClick={(e) => e.stopPropagation()}
                />
            )}
        </Dropdown>
    )
})
