import type {MenuItemType} from "antd/es/menu/hooks/useItems"

export interface SimpleDropdownSelectProps {
    value: string
    options: Omit<MenuItemType, "onClick">[]
    onChange: (value: string) => void
    placeholder?: string
    className?: string
}

export type {MenuItemType}
