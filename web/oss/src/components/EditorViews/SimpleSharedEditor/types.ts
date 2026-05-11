import {SharedEditorProps} from "@agenta/ui/shared-editor"
import {DropdownProps} from "antd"

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
