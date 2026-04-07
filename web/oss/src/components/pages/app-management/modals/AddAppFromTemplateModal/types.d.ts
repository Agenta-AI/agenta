export interface AddAppFromTemplatedModalProps {
    open: boolean
    onCancel: () => void
    handleTemplateCardClick: (templateId: string, appName: string) => Promise<void>
}
