import {DropdownProps} from "antd"

import {SharedEditorProps} from "@/oss/components/Playground/Components/SharedEditor/types"

import {TooltipButtonProps} from "../../EnhancedUIs/Button"

export interface SimpleSharedEditorProps extends SharedEditorProps {
    headerClassName?: string
    headerName?: string | React.ReactNode
    isJSON?: boolean
    isYAML?: boolean
    isHTML?: boolean
    isMinimizeVisible?: boolean
    isFormatVisible?: boolean
    isCopyVisible?: boolean
    formatDropdownProps?: DropdownProps
    copyButtonProps?: TooltipButtonProps
    minimizeButtonProps?: TooltipButtonProps
    disableFormatItems?: {text?: boolean; markdown?: boolean; json?: boolean; yaml?: boolean}
    minimizedHeight?: number
    showTextToMdOutside?: boolean
    defaultMinimized?: boolean
}
export type Format = "text" | "json" | "yaml" | "markdown" | "html"
