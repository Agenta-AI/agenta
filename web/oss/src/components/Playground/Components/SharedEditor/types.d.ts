import type {InputProps, TextAreaProps} from "antd/es/input"

import type {EditorProps} from "@/oss/components/Editor/types"

import type {BaseContainerProps} from "../types"

type SharedAntdInputProps = (InputProps & {textarea?: false}) | (TextAreaProps & {textarea: true})

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
    antdInputProps?: SharedAntdInputProps
    error?: boolean

    noProvider?: boolean
    debug?: boolean
    isTool?: boolean
    handleChange?: (value: string) => void

    syncWithInitialValueChanges?: boolean
}
