export type PromptMessageContentOptionsProps = {
    messageId: string
    className?: string
    propertyId: string
    variantId: string
    isMessageDeletable?: boolean
    disabled?: boolean
    runnable?: boolean
    actions: {
        deleteMessage?: (messageId: string) => void
        rerunMessage?: (messageId: string) => void
    }
}
