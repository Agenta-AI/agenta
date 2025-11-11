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
    }
    resultHashes?: (TestResult | string | null | undefined)[]
    children?: React.ReactNode
}
