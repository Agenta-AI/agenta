import React, {useCallback, useRef} from "react"

import {FileArchive, Image as ImageIcon, Paperclip} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"

interface AttachmentButtonProps {
    onAddImage: (imageUrl: string) => void
    onAddFile: (fileData: string, filename: string, format: string) => void
    disabled?: boolean
}

/**
 * Dropdown button for adding attachments (images and files) to messages.
 */
export const AttachmentButton: React.FC<AttachmentButtonProps> = ({
    onAddImage,
    onAddFile,
    disabled,
}) => {
    const imageInputRef = useRef<HTMLInputElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleImageSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = () => {
                onAddImage(reader.result as string)
            }
            reader.readAsDataURL(file)
            // Reset input
            if (imageInputRef.current) imageInputRef.current.value = ""
        },
        [onAddImage],
    )

    const handleFileSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = () => {
                onAddFile(reader.result as string, file.name, file.type)
            }
            reader.readAsDataURL(file)
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = ""
        },
        [onAddFile],
    )

    const menuItems: MenuProps["items"] = [
        {
            key: "image",
            label: (
                <span className="flex items-center gap-2">
                    <ImageIcon size={14} />
                    <span>Upload image</span>
                </span>
            ),
            onClick: () => imageInputRef.current?.click(),
        },
        {
            key: "file",
            label: (
                <span className="flex items-center gap-2">
                    <FileArchive size={14} />
                    <span>Attach document</span>
                </span>
            ),
            onClick: () => fileInputRef.current?.click(),
        },
    ]

    return (
        <>
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleImageSelect}
            />
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.csv,.json,.xml"
                hidden
                onChange={handleFileSelect}
            />
            <Dropdown menu={{items: menuItems}} trigger={["click"]} disabled={disabled}>
                <Button
                    type="text"
                    size="small"
                    icon={<Paperclip size={14} />}
                    className="text-gray-400 hover:text-gray-600"
                    title="Add attachment"
                />
            </Dropdown>
        </>
    )
}

export default AttachmentButton
