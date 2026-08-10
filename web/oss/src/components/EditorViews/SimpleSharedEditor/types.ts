import type {EnhancedButtonProps} from "@agenta/ui/components/presentational"
import {SharedEditorProps} from "@agenta/ui/shared-editor"
import {DropdownProps} from "antd"

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
    copyButtonProps?: EnhancedButtonProps
    minimizeButtonProps?: EnhancedButtonProps
    disableFormatItems?: {
        text?: boolean
        markdown?: boolean
        json?: boolean
        yaml?: boolean
        html?: boolean
    }
    minimizedHeight?: number
    showTextToMdOutside?: boolean
    defaultMinimized?: boolean
}
export type Format = "text" | "json" | "yaml" | "markdown" | "html"
