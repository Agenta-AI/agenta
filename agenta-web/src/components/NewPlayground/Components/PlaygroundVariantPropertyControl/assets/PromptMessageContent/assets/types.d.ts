export type PromptMessageContentOptionsProps = {
    messageId: string
    className?: string
    propertyId: string
    variantId: string
    isMessageDeletable?: boolean
    disabled?: boolean
    runnable?: boolean
    deleteMessage: (messageId: string) => void
}
