import type {ReactNode} from "react"

import type {SimpleQueue} from "@agenta/entities/simpleQueue"
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
    /** Selection-scoped queue add — adds a known set of item ids. */
    queueAction?: {
        itemType: "traces" | "testcases"
        itemIds: string[]
        /** Menu label. Defaults to "Add annotation queue". */
        label?: string
        disabled?: boolean
        onItemsAdded?: () => void
    }
    /**
     * Filter-scoped queue add — the caller owns the add (e.g. a background
     * scan over a filter). Picking a queue calls `onQueueSelected`;
     * `onBeforeOpen` can gate the picker (return `false` to abort — e.g. the
     * user declined a confirm dialog).
     */
    queueAllMatchingAction?: {
        label: string
        disabled?: boolean
        onBeforeOpen?: () => boolean | Promise<boolean>
        onQueueSelected: (queue: SimpleQueue) => void
    }
}
