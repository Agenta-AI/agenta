export interface PromptMessageContentOptionsProps {
    messageId: string
    className?: string
    minimized?: boolean
    propertyId: string
    variantId: string
    isMessageDeletable?: boolean
    disabled?: boolean
    runnable?: boolean
    actions: {
        deleteMessage?: (messageId: string) => void
        rerunMessage?: (messageId: string) => void
        onClickTestsetDrawer?: (messageId?: string) => void
        minimize?: (messageId?: string) => void
        handleAddUploadSlot?: () => void
    }
    resultHashes?: (TestResult | string | null | undefined)[]
    children?: React.ReactNode
    allowFileUpload?: boolean
    uploadCount?: number
    hideMarkdownToggle?: boolean
    /** When true, only render the minimize control */
    showMinimizeOnly?: boolean
    /** Whether the component is in view-only mode or in mutable mode */
    viewOnly?: boolean
}
