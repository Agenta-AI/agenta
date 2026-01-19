import type {HTMLProps} from "react"

import type {InputProps, TextAreaProps} from "antd/es/input"

import type {EditorProps} from "../Editor"

/**
 * Base interface for components that render as HTML containers
 * @template T - HTML element type, defaults to HTMLDivElement
 */
export interface BaseContainerProps<T = HTMLDivElement> extends HTMLProps<T> {
    /** Additional className to be merged with default styles */
    className?: string
}

type SharedAntdInputProps = (InputProps & {textarea?: false}) | (TextAreaProps & {textarea: true})

export interface SharedEditorProps extends BaseContainerProps {
    /** Unique ID for the editor instance */
    id?: string
    header?: React.ReactNode
    footer?: React.ReactNode
    editorType?: "border" | "borderless"
    state?: "default" | "filled" | "disabled" | "readOnly" | "focus" | "typing"
    placeholder?: string
    initialValue: any
    /** Controlled value - when provided, editor syncs with this value (for undo/redo support) */
    value?: string
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
    propertyId?: string
    baseProperty?: any
    variantId?: string
    handleChange?: (value: string) => void

    syncWithInitialValueChanges?: boolean
    /** Disable debouncing for immediate updates (useful for undo/redo with history tracking) */
    disableDebounce?: boolean
    /** Callback when a JSON property key is Cmd/Meta+clicked (for drill-in navigation) */
    onPropertyClick?: (path: string) => void
}
