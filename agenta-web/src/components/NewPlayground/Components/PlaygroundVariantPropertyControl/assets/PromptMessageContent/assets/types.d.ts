export type PromptMessageContentOptionsProps = {
    messageId: string
    deleteMessage: (messageId: string) => void
    className?: string
    propertyId: string
    variantId: string
    isMessageDeletable?: boolean
    disabled?: boolean
}
