/** One subscription row rendered under its provider group in the Triggers section. */
import {type ReactNode} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {Button, Dropdown, Tooltip} from "antd"
import type {MenuProps} from "antd"

/** A subscription rendered as a child under its provider group: dot + event + actions. */
export function SubscriptionChildRow({
    primary,
    primaryMuted,
    secondary,
    active,
    disabled,
    runSlot,
    onOpen,
    menuItems,
}: {
    primary: string
    primaryMuted?: boolean
    secondary?: string
    active: boolean
    disabled?: boolean
    /** The "Run in playground" affordance (an event-source picker), supplied by the parent. */
    runSlot: ReactNode
    onOpen: () => void
    menuItems: MenuProps["items"]
}) {
    const open = disabled ? undefined : onOpen
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            onClick={open}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget || !open) return
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    open()
                }
            }}
            className={`group flex items-center gap-2.5 rounded px-2.5 py-1.5 transition-colors ${
                disabled
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-[var(--ag-colorFillSecondary)]"
            }`}
        >
            <Tooltip title={active ? "Active" : "Paused"}>
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                        active
                            ? "bg-[var(--ag-colorSuccess)]"
                            : "bg-[var(--ag-colorTextQuaternary)]"
                    }`}
                />
            </Tooltip>
            <div className="min-w-0 flex-1">
                <div
                    className={`truncate text-xs font-medium ${
                        primaryMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                    }`}
                >
                    {primary}
                </div>
                {secondary ? (
                    <div className="truncate text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                        {secondary}
                    </div>
                ) : null}
            </div>
            <div
                className="flex shrink-0 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
            >
                {runSlot}
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
