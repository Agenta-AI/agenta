export interface AddAppFromTemplatedModalProps {
    open: boolean
    onCancel: () => void
    handleTemplateCardClick: (
        templateId: string,
        appName: string,
        appSlug?: string,
    ) => Promise<void>
}
