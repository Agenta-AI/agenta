import {SharedEditorProps} from "@/oss/components/Playground/Components/SharedEditor/types"
import {DropdownProps} from "antd"
import {TooltipButtonProps} from "../../Playground/assets/EnhancedButton"

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
    disableFormatItems?: {text?: boolean, markdown?: boolean, json?: boolean, yaml?: boolean}
    minimizedHeight?: number
    showTextToMdOutside?: boolean
}
export type Format = "text" | "json" | "yaml" | "markdown" | "html"
