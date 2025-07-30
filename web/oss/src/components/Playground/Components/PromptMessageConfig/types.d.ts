import {EditorProps} from "@/oss/components/Editor/types"
import type {EnhancedVariant} from "../../../../lib/shared/variant/transformer/types"
import type {SharedEditorProps} from "../SharedEditor/types"
import type {BaseContainerProps} from "../types"

/**
 * Props for the prompt message configuration component.
 * This component handles the configuration of individual prompt messages
 * including their roles and content.
 */
export interface PromptMessageConfigProps extends BaseContainerProps, SharedEditorProps {
    /** Unique identifier for the variant being configured */
    variantId: EnhancedVariant["id"]
    /** Unique identifier for the message being configured */
    messageId: string
    isMessageDeletable?: boolean
    view?: string
    inputClassName?: string
    rowId?: string
    runnable?: boolean
    debug?: boolean
    editorClassName?: string
    headerClassName?: string
    footerClassName?: string
    initialValue?: string
    editorType?: "border" | "borderless"

    isFunction?: boolean | undefined
    isJSON?: boolean | undefined
    isTool?: boolean | undefined

    deleteMessage?: (messageId: string) => void
    rerunMessage?: (messageId: string) => void
    handleChange?: (value: string) => void
    message?: any

    allowFileUpload?: boolean

    editorProps?: EditorProps
}
