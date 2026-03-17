import type {ButtonProps} from "antd"

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
    queueAction?: {
        itemType: "traces" | "testcases"
        itemIds: string[]
        disabled?: boolean
        onItemsAdded?: () => void
    }
}
