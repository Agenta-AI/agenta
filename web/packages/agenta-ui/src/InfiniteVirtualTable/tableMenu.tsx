import type {ReactNode} from "react"

import {
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from "../components/ui/dropdown-menu"

/**
 * The table's menu model, replacing antd's `MenuProps["items"]`.
 *
 * A plain descriptor rather than JSX so the hooks that build menus stay renderer-agnostic, and
 * so a caller cannot smuggle antd-shaped props (`onClick(e.domEvent)`, `danger`) through it.
 * Stopping propagation is the renderer's job; an item's `onClick` takes no event.
 */
export type TableMenuItem =
    | {type: "divider"; key?: string}
    | {
          key: string
          label: ReactNode
          icon?: ReactNode
          disabled?: boolean
          /** Destructive styling, antd's `danger`. */
          danger?: boolean
          onClick?: () => void
          children?: TableMenuItem[]
      }

const isDivider = (item: TableMenuItem): item is {type: "divider"; key?: string} =>
    "type" in item && item.type === "divider"

export const renderTableMenuItems = (items: TableMenuItem[] | undefined): ReactNode =>
    items?.map((item, index) => {
        if (isDivider(item)) return <DropdownMenuSeparator key={item.key ?? `divider-${index}`} />

        const content = (
            <>
                {item.icon}
                {item.label}
            </>
        )

        if (item.children?.length) {
            return (
                <DropdownMenuSub key={item.key}>
                    <DropdownMenuSubTrigger disabled={item.disabled}>
                        {content}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        {renderTableMenuItems(item.children)}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
            )
        }

        return (
            <DropdownMenuItem
                key={item.key}
                disabled={item.disabled}
                variant={item.danger ? "destructive" : undefined}
                onClick={(event) => {
                    event.stopPropagation()
                    item.onClick?.()
                }}
            >
                {content}
            </DropdownMenuItem>
        )
    })
