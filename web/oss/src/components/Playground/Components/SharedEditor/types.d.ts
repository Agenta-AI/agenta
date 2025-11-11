import type {EditorProps} from "@/oss/components/Editor/types"

import type {BaseContainerProps} from "../types"

export interface SharedEditorProps extends BaseContainerProps {
    header?: React.ReactNode
    footer?: React.ReactNode
    editorType?: "border" | "borderless"
    state?: "default" | "filled" | "disabled" | "readOnly" | "focus" | "typing"
    placeholder?: string
    initialValue: any
    editorClassName?: string
    description?: string
    withTooltip?: boolean
    disabled?: boolean
    editorProps?: EditorProps
    useAntdInput?: boolean
    error?: boolean

    noProvider?: boolean
    debug?: boolean
    isTool?: boolean
    handleChange?: (value: string) => void
}
