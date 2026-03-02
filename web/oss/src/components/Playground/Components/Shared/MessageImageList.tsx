import React from "react"

import PromptImageUpload from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/PromptImageUpload"

interface MessageImageListProps {
    properties: any[]
    disabled?: boolean
    onRemove: (propertyId: string) => void
    onChange?: (propertyId: string, value: string) => void
}

/**
 * Shared list renderer for message image attachments (image_url nodes).
 * Expects "properties" to be an array of property nodes with __id and value/value.value.
 */
const MessageImageList: React.FC<MessageImageListProps> = ({
    properties,
    disabled,
    onRemove,
    onChange,
}) => {
    if (!Array.isArray(properties) || properties.length === 0) return null
    return (
        <div className="flex flex-col my-2 items-center gap-2 w-full">
            {properties.map((property: any) => {
                const currentUrl =
                    property && typeof property.value === "object" && property.value
                        ? ((property.value as any).value ?? "")
                        : ((property as any)?.value ?? "")

                return (
                    <PromptImageUpload
                        key={property.__id}
                        disabled={disabled}
                        imageFile={{
                            status: "done",
                            thumbUrl: currentUrl,
                            uid: property.__id,
                            name: property.__id,
                        }}
                        handleUploadFileChange={(newFile) => {
                            const url =
                                (newFile as any)?.base64 ||
                                (newFile as any)?.url ||
                                (newFile as any)?.thumbUrl ||
                                ""
                            if (!url) return
                            onChange?.(property.__id, url)
                        }}
                        handleRemoveUploadFile={() => onRemove(property.__id)}
                    />
                )
            })}
        </div>
    )
}

export default MessageImageList
