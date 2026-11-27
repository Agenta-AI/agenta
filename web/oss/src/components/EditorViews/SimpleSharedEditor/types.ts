import {SharedEditorProps} from "@agenta/editor/shared-editor"
import {DropdownProps} from "antd"

import type {EnhancedButtonProps} from "@/oss/components/LegacyKit"

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
