export interface DocumentAttachmentValue {
    file_id?: string
    file_data?: string
    filename?: string
    format?: string
}

interface CommonPromptDocumentUploadProps {
    disabled?: boolean
    onRemove: () => void
}

export interface PromptDocumentUploadPropertyProps extends CommonPromptDocumentUploadProps {
    mode?: "property"
    fileIdPropertyId?: string
    fileDataPropertyId?: string
    filenamePropertyId?: string
    formatPropertyId?: string
    fileIdValue?: string
    fileDataValue?: string
    filenameValue?: string
    formatValue?: string
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
