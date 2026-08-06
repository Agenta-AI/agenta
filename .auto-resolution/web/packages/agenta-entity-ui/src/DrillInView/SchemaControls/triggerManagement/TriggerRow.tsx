/** The Triggers section's standalone trigger row (used for schedules). */
import {type ReactNode} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {CaretRight, Flask} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip} from "antd"
import type {MenuProps} from "antd"

/** A trigger row: leading status-dot icon, bold name + chevron, subtitle, run + ⋯ menu. */
export function TriggerRow({
    icon,
    name,
    nameMuted,
    chip,
    subtitle,
    active,
    disabled,
    runDisabled,
    onRun,
    onOpen,
    menuItems,
}: {
    icon: ReactNode
    name: string
    nameMuted?: boolean
    chip?: ReactNode
    subtitle: string
    active: boolean
    disabled?: boolean
    runDisabled?: boolean
    onRun: () => void
    onOpen: () => void
    menuItems: MenuProps["items"]
}) {
    // Read-only mode opens nothing: the row's target is an editable drawer.
    const open = disabled ? undefined : onOpen
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            onClick={open}
            onKeyDown={(e) => {
                // Only the row itself activates — keyboard events bubbling up from the
                // run button or ⋯ menu must not also open the drawer.
                if (e.target !== e.currentTarget || !open) return
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    open()
                }
            }}
            className={`group flex items-center gap-2.5 rounded border border-solid border-[var(--ag-colorBorderSecondary)] px-3 py-2 transition-colors ${disabled ? "cursor-default" : "cursor-pointer hover:border-[var(--ag-colorBorder)]"}`}
        >
            <Tooltip title={active ? "Active" : "Paused"}>
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]">
                    {icon}
                    <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-solid border-[var(--ag-colorBgContainer)] ${
                            active
                                ? "bg-[var(--ag-colorSuccess)]"
                                : "bg-[var(--ag-colorTextQuaternary)]"
                        }`}
                    />
                </span>
            </Tooltip>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span
                        className={`truncate text-xs font-medium ${
                            nameMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                        }`}
                    >
                        {name}
                    </span>
                    <CaretRight
                        size={12}
                        className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                    />
                    {chip ? (
                        <span className="ml-0.5 max-w-[170px] shrink-0 truncate rounded bg-[var(--ag-colorFillSecondary)] px-1.5 py-0.5 text-[10px] text-[var(--ag-colorTextSecondary)]">
                            {chip}
                        </span>
                    ) : null}
                </div>
                <div className="mt-0.5 line-clamp-2 max-w-prose text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                    {subtitle}
                </div>
            </div>
            <div
                className="flex shrink-0 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
            >
                <Tooltip title="Run in playground">
                    <Button
                        type="text"
                        icon={<Flask size={16} />}
                        aria-label="Run in playground"
                        disabled={runDisabled}
                        onClick={(e) => {
                            e.stopPropagation()
                            onRun()
                        }}
                    />
                </Tooltip>
                <Dropdown
                    trigger={["click"]}
                    styles={{root: {width: 180}}}
                    menu={{items: menuItems}}
                >
                    <Button
                        type="text"
                        icon={<MoreOutlined />}
                        aria-label="Open trigger actions"
                        onClick={(e) => e.stopPropagation()}
                    />
                </Dropdown>
            </div>
        </div>
    )
}
