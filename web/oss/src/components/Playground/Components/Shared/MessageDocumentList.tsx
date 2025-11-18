import React from "react"

import PromptDocumentUpload from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/PromptDocumentUpload"

interface DocumentPropertyNode {
    __id?: string
    value?: any
    [key: string]: any
}

interface MessageDocumentListProps {
    items: {
        fileId?: DocumentPropertyNode | null
    }[]
    disabled?: boolean
    onRemove: (propertyId: string) => void
    onChange: (propertyId: string, value: string) => void
}

const extractValue = (node?: DocumentPropertyNode | null): string => {
    if (!node) return ""
    if (typeof node.value === "string") return node.value
    if (node.value && typeof node.value === "object" && "value" in node.value) {
        return node.value.value ?? ""
    }
    if (typeof (node as any).content === "object") {
        const contentVal = (node as any).content?.value
        if (typeof contentVal === "string") return contentVal
    }
    return ""
}

const MessageDocumentList: React.FC<MessageDocumentListProps> = ({
    items,
    disabled,
    onRemove,
    onChange,
}) => {
    if (!Array.isArray(items) || items.length === 0) return null

    return (
        <div className="flex flex-col my-2 items-center gap-2 w-full">
            {items.map((item, index) => {
                const fileIdProp = item.fileId
                if (!fileIdProp || !fileIdProp.__id) return null

                return (
                    <PromptDocumentUpload
                        key={fileIdProp.__id || index}
                        disabled={disabled}
                        mode="property"
                        fileIdPropertyId={fileIdProp.__id}
                        fileIdValue={extractValue(fileIdProp)}
                        onRemove={() => onRemove(fileIdProp.__id!)}
                        onChange={onChange}
                    />
                )
            })}
        </div>
    )
}

export default MessageDocumentList

