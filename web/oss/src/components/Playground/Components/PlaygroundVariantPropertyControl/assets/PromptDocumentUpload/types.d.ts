export interface DocumentAttachmentValue {
    file_id: string
}

interface CommonPromptDocumentUploadProps {
    disabled?: boolean
    onRemove: () => void
}

export interface PromptDocumentUploadPropertyProps extends CommonPromptDocumentUploadProps {
    mode?: "property"
    fileIdPropertyId: string
    fileIdValue: string
    onChange: (propertyId: string, value: string) => void
}

export interface PromptDocumentUploadValueProps extends CommonPromptDocumentUploadProps {
    mode: "value"
    value: DocumentAttachmentValue
    onValueChange: (value: DocumentAttachmentValue) => void
}

export type PromptDocumentUploadProps =
    | PromptDocumentUploadPropertyProps
    | PromptDocumentUploadValueProps
