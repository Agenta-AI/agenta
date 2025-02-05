import type {EnhancedVariant} from "../../assets/utilities/transformer/types"
import type {SharedEditorProps} from "../SharedEditor"
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
    deleteMessage?: (messageId: string) => void
    rerunMessage?: (messageId: string) => void
    editorClassName?: string
    headerClassName?: string
    handleChange?: (value: string) => void
    initialValue?: string
    editorType?: "border" | "borderless"
}
