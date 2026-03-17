import type {ReactNode} from "react"

import type {ButtonProps} from "antd"

export interface AddActionsDropdownAction {
    key: string
    label: string
    icon?: ReactNode
    disabled?: boolean
    onSelect: () => void
}

export interface AddActionsDropdownProps {
    size?: ButtonProps["size"]
    disabled?: boolean
    className?: string
    buttonClassName?: string
    buttonType?: ButtonProps["type"]
    dataTour?: string
    testsetAction?: {
        disabled?: boolean
        onSelect: () => void
    }
    additionalActions?: AddActionsDropdownAction[]
    queueAction?: {
        itemType: "traces" | "testcases"
        itemIds: string[]
        disabled?: boolean
        onItemsAdded?: () => void
    }
}
